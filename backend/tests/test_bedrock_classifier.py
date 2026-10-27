import json
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.core.config import settings
from app.services.categorization.bedrock_classifier import (
    BedrockClassificationResult,
    _clean_json_response,
    classify_with_bedrock,
)


def test_clean_json_response():
    # Plain JSON
    raw = '[{"index": 0, "category_slug": "groceries"}]'
    assert _clean_json_response(raw) == raw

    # Wrapped in markdown code block
    markdown = '```json\n[{"index": 0, "category_slug": "groceries"}]\n```'
    assert _clean_json_response(markdown) == '[{"index": 0, "category_slug": "groceries"}]'

    # Conversational wrapper text
    conversational = 'Here are the classification results:\n[{"index": 0, "category_slug": "groceries"}]\nHope this helps!'
    assert _clean_json_response(conversational) == '[{"index": 0, "category_slug": "groceries"}]'


def test_bedrock_disabled_returns_empty(monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", False)

    txns = [{"raw_payee": "METRO MONTREAL", "amount": -45.0}]
    cats = [{"slug": "groceries", "name": "Groceries", "id": "cat-1", "type": "EXPENSE"}]

    with patch("boto3.client") as mock_boto:
        results = classify_with_bedrock(txns, cats)
        assert results == []
        mock_boto.assert_not_called()


def test_bedrock_empty_input(monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)

    results_no_txns = classify_with_bedrock([], [{"slug": "groceries"}])
    assert results_no_txns == []

    results_no_cats = classify_with_bedrock([{"raw_payee": "IGA"}], [])
    assert results_no_cats == []


def test_classify_with_bedrock_success(monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_MODEL_ID", "amazon.nova-micro-v1:0")

    mock_client = MagicMock()
    converse_payload = [
        {
            "index": 0,
            "category_slug": "groceries",
            "confidence": 0.96,
            "reasoning": "Metro is a prominent grocery supermarket in Quebec",
            "normalized_payee": "Metro",
        },
        {
            "index": 1,
            "category_slug": "coffee-shops",
            "confidence": 0.92,
            "reasoning": "Specialty cafe purchase",
            "normalized_payee": "Cafe Olimpico",
        },
    ]

    mock_client.converse.return_value = {
        "output": {
            "message": {
                "content": [
                    {"text": json.dumps(converse_payload)}
                ]
            }
        }
    }

    with patch("boto3.client", return_value=mock_client) as mock_boto:
        txns = [
            {"raw_payee": "METRO #123 MTL", "amount": -65.20, "currency": "CAD"},
            {"raw_payee": "CAFE OLIMPICO", "amount": -4.75, "currency": "CAD"},
        ]
        cats = [
            {"slug": "groceries", "name": "Groceries", "id": "cat-1", "type": "EXPENSE"},
            {"slug": "coffee-shops", "name": "Coffee Shops", "id": "cat-2", "type": "EXPENSE"},
        ]

        results = classify_with_bedrock(txns, cats)

        mock_boto.assert_called_once_with("bedrock-runtime", region_name=settings.FOLIO_BEDROCK_REGION)
        assert mock_client.converse.called
        call_kwargs = mock_client.converse.call_args.kwargs
        assert call_kwargs["modelId"] == "amazon.nova-micro-v1:0"

        assert len(results) == 2
        assert results[0].category_slug == "groceries"
        assert results[0].confidence == 0.96
        assert results[0].normalized_payee == "Metro"
        assert "Metro" in results[0].reasoning

        assert results[1].category_slug == "coffee-shops"
        assert results[1].confidence == 0.92
        assert results[1].normalized_payee == "Cafe Olimpico"


def test_classify_with_bedrock_client_error(monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)

    mock_client = MagicMock()
    mock_client.converse.side_effect = ClientError(
        {"Error": {"Code": "AccessDeniedException", "Message": "Access Denied"}},
        "Converse",
    )

    with patch("boto3.client", return_value=mock_client):
        txns = [{"raw_payee": "METRO", "amount": -10.0}]
        cats = [{"slug": "groceries", "name": "Groceries"}]

        # Zero unhandled exceptions
        results = classify_with_bedrock(txns, cats)
        assert results == []


def test_classify_with_bedrock_connection_error(monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)

    mock_client = MagicMock()
    mock_client.converse.side_effect = EndpointConnectionError(endpoint_url="https://bedrock.aws")

    with patch("boto3.client", return_value=mock_client):
        txns = [{"raw_payee": "METRO", "amount": -10.0}]
        cats = [{"slug": "groceries", "name": "Groceries"}]

        results = classify_with_bedrock(txns, cats)
        assert results == []


def test_classify_with_bedrock_malformed_json(monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)

    mock_client = MagicMock()
    mock_client.converse.return_value = {
        "output": {
            "message": {
                "content": [
                    {"text": "I'm sorry, I cannot categorize these transactions at this time."}
                ]
            }
        }
    }

    with patch("boto3.client", return_value=mock_client):
        txns = [{"raw_payee": "METRO", "amount": -10.0}]
        cats = [{"slug": "groceries", "name": "Groceries"}]

        results = classify_with_bedrock(txns, cats)
        assert results == []
