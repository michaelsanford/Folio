import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = logging.getLogger("folio.bedrock")

# Bedrock calls happen inside a request, and Lambda / CloudFront give a request
# 30 s in total, which must also cover the S3 upload of the vault. Without
# explicit timeouts botocore waits 60 s per read and retries several times. One
# attempt (max_attempts counts the first call) with a 12 s read keeps a single
# chunk well inside the budget.
BEDROCK_CLIENT_CONFIG = Config(
    connect_timeout=3,
    read_timeout=12,
    retries={"max_attempts": 1, "mode": "standard"},
)
CHUNK_SIZE = 40
MAX_PARALLEL_CHUNKS = 4
# Overall wall-clock budget for one classify_with_bedrock call. Chunks still
# running at the deadline are abandoned: their rows come back unclassified
# (zero confidence), exactly like a failed chunk. Patched in tests.
BATCH_DEADLINE_SECONDS = 20.0

_client_lock = threading.Lock()
_clients: dict[str, Any] = {}


@dataclass
class BedrockClassificationResult:
    category_slug: str
    confidence: float
    reasoning: str
    normalized_payee: str | None = None


def _clean_json_response(raw_text: str) -> str:
    """Extract JSON array or object from raw LLM output, handling markdown code fences."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

    start_idx = cleaned.find("[")
    end_idx = cleaned.rfind("]")
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        cleaned = cleaned[start_idx : end_idx + 1]

    return cleaned


def get_bedrock_client(region: str) -> Any:
    """One bedrock-runtime client per region for the process (boto3 clients are thread-safe)."""
    client = _clients.get(region)
    if client is None:
        with _client_lock:
            client = _clients.get(region)
            if client is None:
                client = boto3.client("bedrock-runtime", region_name=region, config=BEDROCK_CLIENT_CONFIG)
                _clients[region] = client
    return client


def reset_bedrock_client_cache() -> None:
    """Drop cached clients (tests, or after a credential/region change)."""
    with _client_lock:
        _clients.clear()


_SYSTEM_PROMPT = (
    "You are an expert personal finance categorization engine. "
    "Your task is to analyze bank transaction descriptions and classify them into the most appropriate category slug "
    "from the provided categories list. "
    "You must output ONLY a valid JSON array of objects, with NO surrounding markdown fences, commentary, or prologue."
)


def _build_user_prompt(category_summary: list[dict], indexed_txns: list[dict]) -> str:
    return (
        f"Available Categories:\n{json.dumps(category_summary, indent=2)}\n\n"
        f"Transactions to Classify:\n{json.dumps(indexed_txns, indent=2)}\n\n"
        "Instructions:\n"
        "1. For each transaction, select the single best matching category_slug from the Available Categories list.\n"
        "2. Clean and standardize raw_payee into a human-friendly normalized_payee (e.g., 'SQ *BLUE BOTTLE #12' -> 'Blue Bottle Coffee').\n"
        "3. Provide a confidence score between 0.0 and 1.0 (e.g. 0.95 for certain, 0.70 for plausible).\n"
        "4. Provide brief reasoning for your choice.\n"
        "5. Output must be a JSON array with one object per input transaction, formatted as:\n"
        "[\n"
        "  {\n"
        '    "index": 0,\n'
        '    "category_slug": "groceries",\n'
        '    "confidence": 0.95,\n'
        '    "reasoning": "Metro is a major Canadian supermarket chain",\n'
        '    "normalized_payee": "Metro"\n'
        "  }\n"
        "]\n"
        "Return strictly the JSON array."
    )


def _omitted(reason: str) -> BedrockClassificationResult:
    # Zero confidence never clears a threshold, so callers skip the row.
    return BedrockClassificationResult(
        category_slug="shopping",
        confidence=0.0,
        reasoning=reason,
        normalized_payee=None,
    )


def _parse_results(raw_output: str, count: int) -> list[BedrockClassificationResult] | None:
    """Parse one chunk's model output; ``None`` means the whole chunk is unusable."""
    try:
        parsed = json.loads(_clean_json_response(raw_output))
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Failed to decode Bedrock JSON output: %s (Raw: %r)", e, raw_output[:200])
        return None
    if not isinstance(parsed, list):
        logger.warning("Bedrock response is not a JSON list: %r", raw_output[:200])
        return None

    try:
        indexed_results: dict[int, BedrockClassificationResult] = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            slug = item.get("category_slug")
            if slug is None:
                continue
            result_obj = BedrockClassificationResult(
                category_slug=str(slug),
                confidence=float(item.get("confidence", 0.70)),
                reasoning=str(item.get("reasoning", "Classified by Bedrock AI")),
                normalized_payee=item.get("normalized_payee"),
            )
            if idx is not None and isinstance(idx, int):
                indexed_results[idx] = result_obj

        if indexed_results:
            return [
                indexed_results.get(i) or _omitted("Bedrock omitted result for transaction")
                for i in range(count)
            ]

        results = []
        for item in parsed:
            if isinstance(item, dict) and "category_slug" in item:
                results.append(
                    BedrockClassificationResult(
                        category_slug=str(item["category_slug"]),
                        confidence=float(item.get("confidence", 0.70)),
                        reasoning=str(item.get("reasoning", "Classified by Bedrock AI")),
                        normalized_payee=item.get("normalized_payee"),
                    )
                )
        return results[:count]
    except (TypeError, ValueError) as e:
        logger.warning("Error processing Bedrock classification results: %s", e)
        return None


def _classify_chunk(
    client: Any,
    model_id: str,
    category_summary: list[dict],
    chunk: list[dict[str, Any]],
) -> list[BedrockClassificationResult] | None:
    indexed_txns = [
        {
            "index": idx,
            "raw_payee": str(txn.get("raw_payee", "")),
            "amount": txn.get("amount"),
            "currency": txn.get("currency", settings.DEFAULT_CURRENCY),
            "account_type": txn.get("account_type"),
            "date": str(txn.get("date", "")),
        }
        for idx, txn in enumerate(chunk)
    ]
    try:
        response = client.converse(
            modelId=model_id,
            system=[{"text": _SYSTEM_PROMPT}],
            messages=[
                {
                    "role": "user",
                    "content": [{"text": _build_user_prompt(category_summary, indexed_txns)}],
                }
            ],
            inferenceConfig={
                "temperature": 0.0,
                "maxTokens": 4096,
            },
        )
        content_parts = response.get("output", {}).get("message", {}).get("content", [])
        raw_output = "".join(part.get("text", "") for part in content_parts)
    except (ClientError, BotoCoreError) as e:
        logger.warning("AWS Bedrock Converse API error: %s", e)
        return None
    except Exception as e:
        logger.error("Unexpected error invoking Bedrock: %s", e)
        return None
    return _parse_results(raw_output, len(chunk))


def classify_with_bedrock(
    transactions: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    model_id: str | None = None,
    region: str | None = None,
) -> list[BedrockClassificationResult]:
    """
    Tier 4 AI Recourse: Invokes AWS Bedrock to classify bank transactions
    when deterministic rules, user history, and semantic heuristics fail.

    Supports Amazon Nova Micro (amazon.nova-micro-v1:0) and Claude 3 models
    via Bedrock Converse API.

    Transactions go out in chunks of ``CHUNK_SIZE``, up to ``MAX_PARALLEL_CHUNKS``
    at once, so a large batch neither overflows the model's output budget nor
    waits on one long serial call. A chunk that errors or returns unparseable
    JSON loses only its own rows (they come back with zero confidence); the
    other chunks keep their answers. The whole call returns within
    ``BATCH_DEADLINE_SECONDS``: chunks not finished by then are treated as
    failed and are not waited for.

    Zero unhandled exceptions: returns an empty list when disabled or when every
    chunk failed; otherwise exactly one result per input transaction.
    """
    if not settings.FOLIO_BEDROCK_ENABLED:
        logger.debug("Bedrock classification skipped: FOLIO_BEDROCK_ENABLED is False")
        return []

    if not transactions or not categories:
        return []

    target_model_id = model_id or settings.FOLIO_BEDROCK_MODEL_ID
    target_region = region or settings.FOLIO_BEDROCK_REGION

    try:
        client = get_bedrock_client(target_region)
    except Exception as e:
        logger.error("Failed to initialize Bedrock client: %s", e)
        return []

    category_summary = [
        {
            "id": c.get("id"),
            "slug": c.get("slug"),
            "name": c.get("name"),
            "type": str(c.get("type", "")),
        }
        for c in categories
        if c.get("slug")
    ]

    chunks = [transactions[i : i + CHUNK_SIZE] for i in range(0, len(transactions), CHUNK_SIZE)]

    def _run(chunk: list[dict[str, Any]]) -> list[BedrockClassificationResult] | None:
        return _classify_chunk(client, target_model_id, category_summary, chunk)

    deadline = time.monotonic() + BATCH_DEADLINE_SECONDS
    pool = ThreadPoolExecutor(
        max_workers=min(MAX_PARALLEL_CHUNKS, len(chunks)),
        thread_name_prefix="bedrock",
    )
    try:
        futures = [pool.submit(_run, chunk) for chunk in chunks]
        wait(futures, timeout=max(deadline - time.monotonic(), 0.0))
        chunk_results: list[list[BedrockClassificationResult] | None] = []
        late = 0
        for future in futures:
            if future.done() and not future.cancelled():
                error = future.exception()
                if error is not None:
                    logger.error("Unexpected error classifying a Bedrock chunk: %s", error)
                chunk_results.append(None if error is not None else future.result())
            else:
                late += 1
                chunk_results.append(None)
        if late:
            logger.warning(
                "Bedrock deadline of %.0f s reached; %d of %d chunk(s) left unclassified",
                BATCH_DEADLINE_SECONDS,
                late,
                len(chunks),
            )
    finally:
        # Never block the request on stragglers: queued chunks are cancelled and
        # running ones end on their own read timeout in the background.
        pool.shutdown(wait=False, cancel_futures=True)

    if all(r is None for r in chunk_results):
        return []

    results: list[BedrockClassificationResult] = []
    for chunk, chunk_result in zip(chunks, chunk_results):
        if chunk_result is None:
            results.extend(_omitted("Bedrock chunk failed") for _ in chunk)
            continue
        missing = len(chunk) - len(chunk_result)
        results.extend(chunk_result[: len(chunk)])
        results.extend(_omitted("Bedrock omitted result for transaction") for _ in range(max(missing, 0)))
    return results
