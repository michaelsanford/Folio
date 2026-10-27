import json
import logging
import re
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = logging.getLogger("folio.bedrock")


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

    Zero unhandled exceptions: returns empty list on any failure or if disabled.
    """
    if not settings.FOLIO_BEDROCK_ENABLED:
        logger.debug("Bedrock classification skipped: FOLIO_BEDROCK_ENABLED is False")
        return []

    if not transactions or not categories:
        return []

    target_model_id = model_id or settings.FOLIO_BEDROCK_MODEL_ID
    target_region = region or settings.FOLIO_BEDROCK_REGION

    try:
        client = boto3.client("bedrock-runtime", region_name=target_region)
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

    indexed_txns = []
    for idx, txn in enumerate(transactions):
        indexed_txns.append({
            "index": idx,
            "raw_payee": str(txn.get("raw_payee", "")),
            "amount": txn.get("amount"),
            "currency": txn.get("currency", settings.DEFAULT_CURRENCY),
            "account_type": txn.get("account_type"),
            "date": str(txn.get("date", "")),
        })

    system_prompt = (
        "You are an expert personal finance categorization engine. "
        "Your task is to analyze bank transaction descriptions and classify them into the most appropriate category slug "
        "from the provided categories list. "
        "You must output ONLY a valid JSON array of objects, with NO surrounding markdown fences, commentary, or prologue."
    )

    user_prompt = (
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

    raw_output = ""
    try:
        response = client.converse(
            modelId=target_model_id,
            system=[{"text": system_prompt}],
            messages=[
                {
                    "role": "user",
                    "content": [{"text": user_prompt}],
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
        return []
    except Exception as e:
        logger.error("Unexpected error invoking Bedrock: %s", e)
        return []

    try:
        cleaned_json = _clean_json_response(raw_output)
        parsed = json.loads(cleaned_json)
        if not isinstance(parsed, list):
            logger.warning("Bedrock response is not a JSON list: %r", raw_output[:200])
            return []

        indexed_results: dict[int, BedrockClassificationResult] = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            slug = item.get("category_slug")
            if slug is None:
                continue
            conf = float(item.get("confidence", 0.70))
            reasoning = str(item.get("reasoning", "Classified by Bedrock AI"))
            norm = item.get("normalized_payee")
            result_obj = BedrockClassificationResult(
                category_slug=str(slug),
                confidence=conf,
                reasoning=reasoning,
                normalized_payee=norm,
            )
            if idx is not None and isinstance(idx, int):
                indexed_results[idx] = result_obj

        if indexed_results:
            results = []
            for i in range(len(transactions)):
                if i in indexed_results:
                    results.append(indexed_results[i])
                else:
                    results.append(
                        BedrockClassificationResult(
                            category_slug="shopping",
                            confidence=0.0,
                            reasoning="Bedrock omitted result for transaction",
                            normalized_payee=None,
                        )
                    )
            return results

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
        return results

    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Failed to decode Bedrock JSON output: %s (Raw: %r)", e, raw_output[:200])
        return []
    except Exception as e:
        logger.error("Error processing Bedrock classification results: %s", e)
        return []
