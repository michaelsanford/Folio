"""Ingestion correctness: dedup ordinals, row errors, year inference, upload limits,
statement de-duplication, side-effect-free previews and error handling."""
import inspect
import io
from datetime import date
from unittest.mock import patch

import pytest

from app.api import ingestion as ingestion_api
from app.core.config import settings
from app.models.rule import CategorizationRule
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction
from app.services.categorization.bedrock_classifier import BedrockClassificationResult
from app.services.ingestion.deduplication import generate_transaction_hash
from app.services.ingestion.ofx_parser import parse_ofx_content
from app.services.ingestion.preview_common import (
    HashSequencer,
    infer_year,
    parse_statement_date,
)


def _upload(client, content: bytes, filename="statement.csv", account_id=None):
    data = {"account_id": account_id} if account_id else {}
    return client.post(
        "/api/ingestion/upload-preview",
        data=data,
        files={"file": (filename, io.BytesIO(content), "text/csv")},
    )


def _commit_items(preview):
    return [
        {
            "transaction_date": it["transaction_date"],
            "raw_payee": it["raw_payee"],
            "normalized_payee": it["normalized_payee"],
            "amount": it["amount"],
            "import_hash": it["import_hash"],
        }
        for it in preview["items"]
    ]


# ------------------------------------------------------------------ dedup ordinal


def test_ordinal_zero_keeps_the_legacy_fingerprint():
    import hashlib

    legacy = hashlib.sha256("acc|2026-03-01|-425|timhortons".encode()).hexdigest()
    assert generate_transaction_hash("acc", "2026-03-01", -4.25, "TIM HORTONS") == legacy
    assert generate_transaction_hash("acc", "2026-03-01", -4.25, "TIM HORTONS", ordinal=0) == legacy
    second = hashlib.sha256("acc|2026-03-01|-425|timhortons|1".encode()).hexdigest()
    assert generate_transaction_hash("acc", "2026-03-01", -4.25, "TIM HORTONS", ordinal=1) == second


def test_sequencer_numbers_identical_rows_only():
    seq = HashSequencer()
    a = seq.next_hash("acc", "2026-03-01", -4.25, "TIM HORTONS")
    b = seq.next_hash("acc", "2026-03-01", -4.25, "TIM HORTONS")
    c = seq.next_hash("acc", "2026-03-01", -4.50, "TIM HORTONS")
    assert a == generate_transaction_hash("acc", "2026-03-01", -4.25, "TIM HORTONS")
    assert b == generate_transaction_hash("acc", "2026-03-01", -4.25, "TIM HORTONS", ordinal=1)
    assert c == generate_transaction_hash("acc", "2026-03-01", -4.50, "TIM HORTONS")


def test_two_identical_purchases_both_import_and_reimport_is_fully_duplicate(client, db_session, sample_checking_account):
    csv_data = (
        b"Date,Description,Amount\n"
        b"2026-03-01,TIM HORTONS,-4.25\n"
        b"2026-03-01,TIM HORTONS,-4.25\n"
        b"2026-03-02,METRO,-40.00\n"
    )
    preview = _upload(client, csv_data, account_id=sample_checking_account.id).json()
    hashes = [it["import_hash"] for it in preview["items"]]
    assert len(set(hashes)) == 3, "the second coffee must not share the first one's fingerprint"

    resp = client.post("/api/ingestion/commit", json={
        "account_id": sample_checking_account.id,
        "items": _commit_items(preview),
    })
    assert resp.status_code == 200
    assert resp.json()["committed_count"] == 3

    again = _upload(client, csv_data, account_id=sample_checking_account.id).json()
    assert again["duplicates_count"] == 3
    assert again["new_count"] == 0


def test_auto_detected_commit_rekeys_with_ordinals(client, db_session):
    csv_data = b"Date,Description,Amount\n2026-03-01,STM OPUS,-3.75\n2026-03-01,STM OPUS,-3.75\n"
    preview = _upload(client, csv_data, filename="td_chequing.csv").json()
    acc = preview["detected_accounts"][0]
    resp = client.post("/api/ingestion/commit", json={
        "accounts": [{
            "source_account_key": acc["source_account_key"],
            "name": acc["suggested_name"],
            "type": acc["suggested_type"],
            "currency": acc["currency"],
        }],
        "items": [dict(i, source_account_key=it["source_account_key"]) for i, it in zip(_commit_items(preview), preview["items"])],
    })
    assert resp.status_code == 200
    assert resp.json()["committed_count"] == 2
    account_id = resp.json()["accounts"][0]["account_id"]
    stored = {t.import_hash for t in db_session.query(Transaction).all()}
    assert stored == {
        generate_transaction_hash(account_id, "2026-03-01", -3.75, "STM OPUS"),
        generate_transaction_hash(account_id, "2026-03-01", -3.75, "STM OPUS", ordinal=1),
    }


# ------------------------------------------------------------------ dates


def test_unparseable_csv_date_is_a_row_error_not_today(client, sample_checking_account):
    csv_data = b"Date,Description,Amount\n2026-03-01,GOOD ROW,-1.00\nnot-a-date,BAD ROW,-2.00\n"
    preview = _upload(client, csv_data, account_id=sample_checking_account.id).json()
    assert [it["raw_payee"] for it in preview["items"]] == ["GOOD ROW"]
    assert len(preview["row_errors"]) == 1
    err = preview["row_errors"][0]
    assert err["value"] == "not-a-date"
    assert err["row_number"] == 3
    assert "date" in err["message"].lower()


def test_ofx_row_without_valid_date_is_reported(db_session, sample_checking_account):
    ofx = b"""OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>CAD
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260301
<TRNAMT>-10.00
<FITID>A1
<NAME>GOOD
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261399
<TRNAMT>-11.00
<FITID>A2
<NAME>BAD MONTH
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
"""
    preview = parse_ofx_content(db_session, sample_checking_account.id, ofx, "s.ofx")
    assert [it.raw_payee for it in preview.items] == ["GOOD"]
    assert len(preview.row_errors) == 1
    assert preview.row_errors[0].value == "20261399"


def test_commit_rejects_invalid_date_with_400(client, db_session, sample_checking_account):
    resp = client.post("/api/ingestion/commit", json={
        "account_id": sample_checking_account.id,
        "items": [{
            "transaction_date": "31/31/2026",
            "raw_payee": "X",
            "normalized_payee": "X",
            "amount": -1.0,
            "import_hash": "h1",
        }],
    })
    assert resp.status_code == 400
    assert "transaction_date" in resp.json()["detail"]
    assert db_session.query(Transaction).count() == 0


@pytest.mark.parametrize(
    "month,day,reference,expected",
    [
        (12, 28, date(2026, 1, 15), date(2025, 12, 28)),  # December row on a January statement
        (1, 10, date(2026, 1, 15), date(2026, 1, 10)),
        (1, 20, date(2026, 1, 15), date(2025, 1, 20)),    # after the closing date -> last year
        (2, 29, date(2026, 3, 31), date(2024, 2, 29)),    # leap day walks back to a leap year
    ],
)
def test_infer_year(month, day, reference, expected):
    assert infer_year(month, day, reference) == expected


def test_parse_statement_date_keeps_explicit_years():
    ref = date(2026, 1, 15)
    assert parse_statement_date("2024-07-04", ref).date() == date(2024, 7, 4)
    assert parse_statement_date("07/04/24", ref).date() == date(2024, 7, 4)
    assert parse_statement_date("Dec 30", ref).date() == date(2025, 12, 30)
    assert parse_statement_date("12/30", ref).date() == date(2025, 12, 30)
    with pytest.raises(ValueError):
        parse_statement_date("TOTAL", ref)


def test_pdf_reference_date_comes_from_statement_header():
    from app.services.ingestion.pdf_parser import _statement_reference_date

    header = "Statement period: December 1, 2025 to December 31, 2025\nAccount ending 1234"
    assert _statement_reference_date([header]) == date(2025, 12, 31)
    assert _statement_reference_date(["no dates here"]) == date.today()


# ------------------------------------------------------------------ uploads


def test_upload_over_limit_is_413_with_the_mb_limit(client, sample_checking_account, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE_BYTES", 1024 * 1024)
    big = b"Date,Description,Amount\n" + b"2026-03-01,X,-1.00\n" * 70000
    resp = _upload(client, big, account_id=sample_checking_account.id)
    assert resp.status_code == 413
    assert "1 MB" in resp.json()["detail"]


def test_same_file_reuses_its_statement_record(client, db_session, sample_checking_account):
    csv_data = b"Date,Description,Amount\n2026-03-01,METRO,-40.00\n"
    first = _upload(client, csv_data, account_id=sample_checking_account.id).json()
    second = _upload(client, csv_data, account_id=sample_checking_account.id).json()
    assert first["file_id"] == second["file_id"]
    assert db_session.query(StatementFile).count() == 1


def test_ephemeral_upload_dir_keeps_no_copy(client, db_session, sample_checking_account, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio-test")
    resp = _upload(client, b"Date,Description,Amount\n2026-03-01,METRO,-40.00\n", account_id=sample_checking_account.id)
    assert resp.status_code == 200
    assert not (tmp_path / "uploads").exists() or not any((tmp_path / "uploads").iterdir())
    assert db_session.query(StatementFile).count() == 1


def test_ingestion_routes_are_sync():
    # Blocking parse/classify work must run in the threadpool, not on the event loop.
    for fn in (
        ingestion_api.upload_statement_preview,
        ingestion_api.commit_ingestion_batch,
        ingestion_api.list_statement_files,
        ingestion_api.delete_statement_file,
    ):
        assert not inspect.iscoroutinefunction(fn), fn.__name__


# ------------------------------------------------------------------ preview side effects


def test_preview_never_persists_bedrock_rules(client, db_session, sample_checking_account, monkeypatch):
    from app.api.rules import seed_default_rules

    seed_default_rules(db_session)  # as startup does
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)
    rules_before = db_session.query(CategorizationRule).count()
    csv_data = b"Date,Description,Amount\n2026-03-01,ZZQX UNSEEN VENDOR 991,-12.00\n2026-03-02,QQZX OTHER VENDOR 7,-3.00\n"

    def fake_bedrock(txns, cats, *a, **k):
        return [
            BedrockClassificationResult(category_slug="groceries", confidence=0.95, reasoning="test", normalized_payee="Vendor")
            for _ in txns
        ]

    with patch("app.services.categorization.engine.classify_with_bedrock", side_effect=fake_bedrock) as mocked:
        preview = _upload(client, csv_data, account_id=sample_checking_account.id).json()

    assert mocked.call_count == 1, "the preview classifies its rows in one batched call"
    assert all(it["classification_tier"] == "BEDROCK_AI" for it in preview["items"])
    db_session.expire_all()
    assert db_session.query(CategorizationRule).count() == rules_before, "a preview must not learn rules"


# ------------------------------------------------------------------ error handling


def test_post_commit_failure_keeps_the_committed_import(client, db_session, sample_checking_account, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("linking exploded")

    monkeypatch.setattr(ingestion_api, "link_offsetting_transfers", boom)
    with pytest.raises(RuntimeError):
        client.post("/api/ingestion/commit", json={
            "account_id": sample_checking_account.id,
            "items": [{
                "transaction_date": "2026-03-01", "raw_payee": "X", "normalized_payee": "X",
                "amount": -1.0, "import_hash": "h-sync",
            }],
        })
    assert db_session.query(Transaction).count() == 1


def test_corrupt_pdf_is_a_400_not_a_500(client, sample_checking_account):
    resp = client.post(
        "/api/ingestion/upload-preview",
        data={"account_id": sample_checking_account.id},
        files={"file": ("statement.pdf", io.BytesIO(b"%PDF-1.4\n garbage that is not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400
