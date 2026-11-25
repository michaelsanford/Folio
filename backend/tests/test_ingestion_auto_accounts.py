"""Tests for automatic account detection/creation across CSV, OFX, and PDF ingestion."""
import io
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.models.account import Account, AccountType
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction
from app.services.ingestion.account_detector import (
    infer_account_type,
    infer_institution,
    mask_account_number,
)
from app.services.ingestion.pdf_parser import parse_pdf_content


def _make_minimal_pdf(lines: list[str]) -> bytes:
    """Build a minimal valid single-page PDF containing text lines for pdfplumber tests."""
    escaped = [
        line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        for line in lines
    ]
    ops = ["BT", "/F1 10 Tf", "50 750 Td"]
    for idx, line in enumerate(escaped):
        if idx > 0:
            ops.append("0 -14 Td")
        ops.append(f"({line}) Tj")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")

    objs = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
        ),
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        (
            f"5 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode("latin-1")
            + stream
            + b"\nendstream\nendobj\n"
        ),
    ]

    buf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for obj in objs:
        offsets.append(len(buf))
        buf.extend(obj)

    xref_pos = len(buf)
    buf.extend(f"xref\n0 {len(objs) + 1}\n".encode("latin-1"))
    buf.extend(b"0000000000 65535 f \n")
    for off in offsets:
        buf.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    buf.extend(
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1")
    )
    return bytes(buf)


def _synthetic_rbc_multi_account_csv(extra_row: str = "") -> bytes:
    """Synthetic RBC-style cp1252 CSV spanning 6 accounts, CAD$/USD$, Description 2, and transfers."""
    rows = [
        '"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"',
        '"Chequing","09231-1114401","7/23/2026","","PAYROLL DEPOSIT","SYNTHETIC CORP ","3200.00","",',
        '"Chequing","09231-1114401","7/24/2026","","MISC PAYMENT","SYNTHETIC VISA ","-450.00","",',
        '"Chequing","09231-1114401","7/25/2026","","ONLINE TRANSFER","SAVINGS TRANSFER ","-200.00","",',
        '"Chequing","09231-2225502","7/26/2026","","ÉPICERIE DU COIN","LOCAL SHOP ","-42.15","",',
        '"Savings","09231-3336603","7/25/2026","","WWW TRANSFER","FROM CHEQUING ","200.00","",',
        '"MasterCard","5510000000007704","7/27/2026","","CORNER BAKERY","","-18.90","",',
        '"Visa","4514000000008805","7/24/2026","","PAYMENT THANK YOU","","450.00","",',
        '"Visa","4514000000008805","7/28/2026","","CLOUD SERVICE","10.00 USD @ 1.35","","-10.00",',
        '"Royal Credit Line","00496-00000009906","7/29/2026","","INTEREST PAYMENT","12.50","0.00","",',
        '"Royal Credit Line","00496-00000009906","7/30/2026","","ADVANCE DRAW","","-500.00","",',
    ]
    if extra_row:
        rows.append(extra_row)
    return "\n".join(rows).encode("cp1252")


def test_account_detector_helpers_and_masking():
    assert mask_account_number("4514123456788805") == "*8805"
    assert mask_account_number("09231-1114401") == "*4401"
    assert mask_account_number("123") == "*123"
    assert mask_account_number("  ") is None
    assert mask_account_number(None) is None

    assert infer_account_type("Chequing") == AccountType.CHECKING
    assert infer_account_type("Savings") == AccountType.SAVINGS
    assert infer_account_type("HISA") == AccountType.HISA
    assert infer_account_type("Visa") == AccountType.CREDIT_CARD
    assert infer_account_type("MasterCard") == AccountType.CREDIT_CARD
    assert infer_account_type("Royal Credit Line") == AccountType.LINE_OF_CREDIT

    full_inst, short_inst = infer_institution(
        headers=[
            "Account Type",
            "Account Number",
            "Transaction Date",
            "Cheque Number",
            "Description 1",
            "Description 2",
            "CAD$",
            "USD$",
        ]
    )
    assert full_inst == "Royal Bank of Canada (RBC)"
    assert short_inst == "RBC"


def test_empty_workspace_multi_account_rbc_csv_preview_commit_and_reimport(client, db_session):
    assert db_session.query(Account).count() == 0

    csv_bytes = _synthetic_rbc_multi_account_csv()
    preview_resp = client.post(
        "/api/ingestion/upload-preview",
        files={"file": ("rbc_export.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert preview_resp.status_code == 200
    raw_json_text = preview_resp.text
    preview = preview_resp.json()

    # Raw PAN / full account numbers must never appear anywhere in API response
    for secret_num in (
        "09231-1114401",
        "09231-2225502",
        "09231-3336603",
        "5510000000007704",
        "4514000000008805",
        "00496-00000009906",
    ):
        assert secret_num not in raw_json_text

    assert preview["is_multi_account"] is True
    assert preview["total_parsed"] == 10
    assert preview["new_count"] == 10
    assert preview["duplicates_count"] == 0
    assert len(preview["detected_accounts"]) == 6

    masks = {acc["account_number_mask"] for acc in preview["detected_accounts"]}
    assert masks == {"*4401", "*5502", "*6603", "*7704", "*8805", "*9906"}

    types_by_mask = {acc["account_number_mask"]: acc["suggested_type"] for acc in preview["detected_accounts"]}
    assert types_by_mask["*4401"] == "CHECKING"
    assert types_by_mask["*5502"] == "CHECKING"
    assert types_by_mask["*6603"] == "SAVINGS"
    assert types_by_mask["*7704"] == "CREDIT_CARD"
    assert types_by_mask["*8805"] == "CREDIT_CARD"
    assert types_by_mask["*9906"] == "LINE_OF_CREDIT"

    # Description 2 preserved as notes (including cp1252 accented characters in raw_payee)
    notes_by_payee = {it["raw_payee"]: it["notes"] for it in preview["items"]}
    assert notes_by_payee["PAYROLL DEPOSIT"] == "SYNTHETIC CORP"
    assert notes_by_payee["CLOUD SERVICE"] == "10.00 USD @ 1.35"
    assert "ÉPICERIE DU COIN" in notes_by_payee

    # Offsetting cross-account transfers are highlighted in preview
    transfer_flagged = [
        it for it in preview["items"] if it["potential_transfer_account_name"]
    ]
    assert len(transfer_flagged) >= 2

    # Commit creating all 6 accounts and pairing transfers
    commit_payload = {
        "statement_file_id": preview["file_id"],
        "auto_detect_transfers": True,
        "accounts": [
            {
                "source_account_key": acc["source_account_key"],
                "name": acc["suggested_name"],
                "type": acc["suggested_type"],
                "institution": acc["institution"],
                "account_number_mask": acc["account_number_mask"],
                "currency": acc["currency"],
            }
            for acc in preview["detected_accounts"]
        ],
        "items": [
            {
                "transaction_date": it["transaction_date"],
                "raw_payee": it["raw_payee"],
                "normalized_payee": it["normalized_payee"],
                "amount": it["amount"],
                "currency": it["currency"],
                "category_id": it["suggested_category_id"],
                "notes": it["notes"],
                "import_hash": it["import_hash"],
                "source_account_key": it["source_account_key"],
            }
            for it in preview["items"]
        ],
    }

    commit_resp = client.post("/api/ingestion/commit", json=commit_payload)
    assert commit_resp.status_code == 200
    commit_data = commit_resp.json()
    assert commit_data["committed_count"] == 10
    assert commit_data["accounts_created_count"] == 6
    assert commit_data["transfers_linked_count"] == 2  # +/-450.00 and +/-200.00
    assert len(commit_data["accounts"]) == 6

    # Liabilities come out as the positive amount owed; bank accounts keep their sign.
    balances = {a.account_number_mask: float(a.current_balance) for a in db_session.query(Account).all()}
    assert balances["*4401"] == pytest.approx(2550.00)
    assert balances["*7704"] == pytest.approx(18.90), "a MasterCard purchase is owed, not negative"
    assert balances["*9906"] == pytest.approx(500.00), "a credit line draw is owed, not negative"
    # The Visa was paid 450 against a 10 purchase: it is 440 in credit.
    assert balances["*8805"] == pytest.approx(-440.00)
    mastercard_id = next(a.id for a in db_session.query(Account).all() if a.account_number_mask == "*7704")
    summary = {a["account_id"]: a["new_account_balance"] for a in commit_data["accounts"]}
    assert summary[mastercard_id] == pytest.approx(18.90), "the import summary shows the amount owed"

    db_session.expire_all()
    assert db_session.query(Account).count() == 6
    assert db_session.query(Transaction).count() == 10

    # Verify notes and USD currency persisted accurately
    cloud_txn = db_session.query(Transaction).filter(Transaction.raw_payee == "CLOUD SERVICE").first()
    assert cloud_txn is not None
    assert cloud_txn.notes == "10.00 USD @ 1.35"
    assert cloud_txn.currency == "USD"

    # Re-import same CSV + 1 new row: auto-matches all 6 accounts, flags 10 duplicates, imports 1
    reupload_bytes = _synthetic_rbc_multi_account_csv(
        extra_row='"Visa","4514000000008805","7/31/2026","","COFFEE SHOP","","-4.75","",'
    )
    repreview_resp = client.post(
        "/api/ingestion/upload-preview",
        files={"file": ("rbc_export_2.csv", io.BytesIO(reupload_bytes), "text/csv")},
    )
    assert repreview_resp.status_code == 200
    repreview = repreview_resp.json()
    assert repreview["total_parsed"] == 11
    assert repreview["duplicates_count"] == 10
    assert repreview["new_count"] == 1
    assert all(acc["matched_account_id"] is not None for acc in repreview["detected_accounts"])

    new_items = [it for it in repreview["items"] if not it["is_duplicate"]]
    assert len(new_items) == 1
    assert new_items[0]["raw_payee"] == "COFFEE SHOP"

    recommit_resp = client.post(
        "/api/ingestion/commit",
        json={
            "statement_file_id": repreview["file_id"],
            "accounts": [
                {
                    "source_account_key": acc["source_account_key"],
                    "existing_account_id": acc["matched_account_id"],
                    "type": acc["suggested_type"],
                    "currency": acc["currency"],
                }
                for acc in repreview["detected_accounts"]
                if acc["source_account_key"] == new_items[0]["source_account_key"]
            ],
            "items": [
                {
                    "transaction_date": it["transaction_date"],
                    "raw_payee": it["raw_payee"],
                    "normalized_payee": it["normalized_payee"],
                    "amount": it["amount"],
                    "currency": it["currency"],
                    "notes": it["notes"],
                    "import_hash": it["import_hash"],
                    "source_account_key": it["source_account_key"],
                }
                for it in new_items
            ],
        },
    )
    assert recommit_resp.status_code == 200
    recommit = recommit_resp.json()
    assert recommit["committed_count"] == 1
    assert recommit["accounts_created_count"] == 0
    assert db_session.query(Account).count() == 6
    assert db_session.query(Transaction).count() == 11


def test_skipping_account_items_does_not_create_empty_account(client, db_session):
    csv_bytes = _synthetic_rbc_multi_account_csv()
    preview = client.post(
        "/api/ingestion/upload-preview",
        files={"file": ("rbc_skip.csv", io.BytesIO(csv_bytes), "text/csv")},
    ).json()

    only_checking = [
        it for it in preview["items"] if it["account_label"] and "Chequing (*4401)" in it["account_label"]
    ]
    assert len(only_checking) == 3

    resp = client.post(
        "/api/ingestion/commit",
        json={
            "statement_file_id": preview["file_id"],
            "accounts": [
                {
                    "source_account_key": acc["source_account_key"],
                    "name": acc["suggested_name"],
                    "type": acc["suggested_type"],
                    "institution": acc["institution"],
                    "account_number_mask": acc["account_number_mask"],
                    "currency": acc["currency"],
                }
                for acc in preview["detected_accounts"]
            ],
            "items": [
                {
                    "transaction_date": it["transaction_date"],
                    "raw_payee": it["raw_payee"],
                    "normalized_payee": it["normalized_payee"],
                    "amount": it["amount"],
                    "currency": it["currency"],
                    "notes": it["notes"],
                    "import_hash": it["import_hash"],
                    "source_account_key": it["source_account_key"],
                }
                for it in only_checking
            ],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["accounts_created_count"] == 1
    assert db_session.query(Account).count() == 1
    assert db_session.query(Transaction).count() == 3


def test_auto_create_commit_rollback_is_atomic(client, db_session, monkeypatch):
    import app.api.ingestion as ingestion

    def boom(db, learned):
        raise RuntimeError("simulated mid-commit failure")

    monkeypatch.setattr(ingestion, "auto_learn_rules_bulk", boom)

    csv_data = b"Date,Description,Amount\n2026-08-01,Test Merchant,-12.34\n"
    preview = client.post(
        "/api/ingestion/upload-preview",
        files={"file": ("td_chequing.csv", io.BytesIO(csv_data), "text/csv")},
    ).json()

    acc = preview["detected_accounts"][0]
    it = preview["items"][0]
    resp = client.post(
        "/api/ingestion/commit",
        json={
            "statement_file_id": preview["file_id"],
            "accounts": [
                {
                    "source_account_key": acc["source_account_key"],
                    "name": acc["suggested_name"],
                    "type": acc["suggested_type"],
                    "institution": acc["institution"],
                    "currency": acc["currency"],
                }
            ],
            "items": [
                {
                    "transaction_date": it["transaction_date"],
                    "raw_payee": it["raw_payee"],
                    "normalized_payee": it["normalized_payee"],
                    "amount": it["amount"],
                    "import_hash": it["import_hash"],
                    "source_account_key": it["source_account_key"],
                }
            ],
        },
    )
    assert resp.status_code == 500
    assert "simulated" not in resp.text
    assert db_session.query(Account).count() == 0, "new account must be rolled back too"
    assert db_session.query(Transaction).count() == 0


def test_empty_workspace_single_csv_ofx_and_pdf(client, db_session):
    # 1. Generic single-account CSV without account columns
    generic_csv = b"Date,Description,Amount\n2026-09-01,GROCERY OUTLET,-64.20\n"
    csv_preview = client.post(
        "/api/ingestion/upload-preview",
        files={"file": ("tangerine_daily.csv", io.BytesIO(generic_csv), "text/csv")},
    ).json()
    assert csv_preview["is_multi_account"] is False
    assert len(csv_preview["detected_accounts"]) == 1
    assert csv_preview["detected_accounts"][0]["institution"] == "Tangerine Bank"
    assert csv_preview["detected_accounts"][0]["suggested_type"] == "CHECKING"

    # 2. OFX with BANKACCTFROM and CCACCTFROM
    ofx_bytes = b"""OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20260910120000
<LANGUAGE>ENG
<FI><ORG>BMO</ORG><FID>001</FID></FI>
</SONRS>
</SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>1
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<CCSTMTRS>
<CURDEF>CAD
<CCACCTFROM>
<ACCTID>5100123456789012
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901000000
<DTEND>20260910000000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260905120000
<TRNAMT>-32.50
<FITID>FITCC9001
<NAME>CORNER PHARMACY
</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>
"""
    ofx_resp = client.post(
        "/api/ingestion/upload-preview",
        files={"file": ("bmo_card.ofx", io.BytesIO(ofx_bytes), "application/x-ofx")},
    )
    assert ofx_resp.status_code == 200
    assert "5100123456789012" not in ofx_resp.text
    ofx_preview = ofx_resp.json()
    assert len(ofx_preview["detected_accounts"]) == 1
    ofx_acc = ofx_preview["detected_accounts"][0]
    assert ofx_acc["suggested_type"] == "CREDIT_CARD"
    assert ofx_acc["account_number_mask"] == "*9012"
    assert ofx_acc["institution"] == "Bank of Montreal (BMO)"

    # Commit the OFX account
    ofx_item = ofx_preview["items"][0]
    ofx_commit = client.post(
        "/api/ingestion/commit",
        json={
            "statement_file_id": ofx_preview["file_id"],
            "accounts": [
                {
                    "source_account_key": ofx_acc["source_account_key"],
                    "name": ofx_acc["suggested_name"],
                    "type": ofx_acc["suggested_type"],
                    "institution": ofx_acc["institution"],
                    "account_number_mask": ofx_acc["account_number_mask"],
                    "currency": ofx_acc["currency"],
                }
            ],
            "items": [
                {
                    "transaction_date": ofx_item["transaction_date"],
                    "raw_payee": ofx_item["raw_payee"],
                    "normalized_payee": ofx_item["normalized_payee"],
                    "amount": ofx_item["amount"],
                    "currency": ofx_item["currency"],
                    "import_hash": ofx_item["import_hash"],
                    "source_account_key": ofx_item["source_account_key"],
                }
            ],
        },
    )
    assert ofx_commit.status_code == 200
    assert ofx_commit.json()["accounts_created_count"] == 1

    # 3. PDF auto-detect in empty/partial workspace
    pdf_bytes = _make_minimal_pdf([
        "RBC Royal Bank Chequing Statement",
        "Account ending in 7788",
        "09/12/2026 METRO GROCERY $54.10",
    ])
    pdf_preview = parse_pdf_content(db_session, None, pdf_bytes, "statement.pdf")
    assert len(pdf_preview.detected_accounts) == 1
    assert pdf_preview.detected_accounts[0].account_number_mask == "*7788"
    assert pdf_preview.detected_accounts[0].institution == "Royal Bank of Canada (RBC)"
    assert pdf_preview.total_parsed == 1
    assert pdf_preview.items[0].amount == -54.10


def test_alembic_0004_migration_allows_nullable_statement_file(tmp_path: Path, monkeypatch):
    db_file = tmp_path / "mig_test.db"
    db_url = f"sqlite:///{db_file.as_posix()}"

    backend_dir = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)

    # Override settings.SQLITE_DB_PATH because migrations/env.py reads SQLALCHEMY_DATABASE_URI
    from app.core.config import settings

    monkeypatch.setattr(settings, "SQLITE_DB_PATH", db_file)
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO statement_files "
                    "(id, account_id, filename, file_path, file_hash, mime_type, file_size, transaction_count, uploaded_at) "
                    "VALUES ('sf-1', NULL, 'multi.csv', '/tmp/multi.csv', 'abc', 'text/csv', 10, 0, '2026-01-01 00:00:00')"
                )
            )
            row = conn.execute(text("SELECT account_id FROM statement_files WHERE id='sf-1'")).fetchone()
            assert row is not None and row[0] is None
    finally:
        engine.dispose()

    command.downgrade(cfg, "0003")
    command.upgrade(cfg, "head")



def test_deterministic_seeded_category_and_rule_ids_across_fresh_dbs():
    from sqlalchemy.orm import sessionmaker
    from app.api.categories import seed_default_categories
    from app.api.rules import seed_default_rules
    from app.core.database import Base
    from app.models.category import Category
    from app.models.rule import CategorizationRule

    snapshots = []
    for _ in range(2):
        eng = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=eng)
        SessionMaker = sessionmaker(bind=eng)
        sess = SessionMaker()
        try:
            seed_default_categories(sess)
            seed_default_rules(sess)
            cat_map = {c.slug: c.id for c in sess.query(Category).all()}
            rule_map = {(r.pattern_type.value, r.pattern): r.id for r in sess.query(CategorizationRule).all()}
            snapshots.append((cat_map, rule_map))
        finally:
            sess.close()
            eng.dispose()

    assert len(snapshots[0][0]) > 0
    assert len(snapshots[0][1]) > 0
    assert snapshots[0][0] == snapshots[1][0]
    assert snapshots[0][1] == snapshots[1][1]


def test_commit_resolves_category_name_fallback_when_category_id_is_stale(client, db_session, sample_checking_account):
    from app.models.category import Category

    groceries = db_session.query(Category).filter(Category.slug == "groceries").first()
    assert groceries is not None

    commit_resp = client.post(
        "/api/ingestion/commit",
        json={
            "account_id": sample_checking_account.id,
            "auto_detect_transfers": False,
            "items": [
                {
                    "transaction_date": "2026-08-01",
                    "raw_payee": "MAXI GROCERY",
                    "normalized_payee": "Maxi",
                    "amount": -52.40,
                    "currency": "CAD",
                    "category_id": "00000000-0000-0000-0000-00000000dead",
                    "category_name": "groceries",
                    "import_hash": "hash-stale-cat-1",
                },
                {
                    "transaction_date": "2026-08-02",
                    "raw_payee": "UNKNOWN SHOP",
                    "normalized_payee": "Unknown Shop",
                    "amount": -12.00,
                    "currency": "CAD",
                    "import_hash": "hash-uncat-2",
                },
            ],
        },
    )
    assert commit_resp.status_code == 200
    assert commit_resp.json()["committed_count"] == 2

    tx1 = db_session.query(Transaction).filter(Transaction.import_hash == "hash-stale-cat-1").first()
    tx2 = db_session.query(Transaction).filter(Transaction.import_hash == "hash-uncat-2").first()
    assert tx1 is not None and tx1.splits[0].category_id == groceries.id
    assert tx2 is not None and tx2.splits[0].category_id is None
