"""Uploaded statements must be removable, without taking ledger history with them."""
import io
from pathlib import Path

from app.core.config import settings
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction

CSV = b"Date,Description,Amount\n2026-03-01,METRO GROCERY,-42.50\n2026-03-02,TIM HORTONS,-4.25\n"


def _upload(client, account_id: str):
    return client.post(
        "/api/ingestion/upload-preview",
        data={"account_id": account_id},
        files={"file": ("statement.csv", io.BytesIO(CSV), "text/csv")},
    )


def test_uploaded_statement_can_be_deleted(client, db_session, sample_checking_account):
    resp = _upload(client, sample_checking_account.id)
    assert resp.status_code == 200
    file_id = resp.json()["file_id"]

    stored = Path(db_session.query(StatementFile).filter(StatementFile.id == file_id).first().file_path)
    assert stored.is_file()

    assert client.delete(f"/api/ingestion/statement-files/{file_id}").status_code == 204
    assert db_session.query(StatementFile).filter(StatementFile.id == file_id).first() is None
    assert not stored.exists(), "the file on disk must go too"


def test_deleting_a_statement_keeps_its_imported_transactions(client, db_session, sample_checking_account):
    preview = _upload(client, sample_checking_account.id).json()
    file_id = preview["file_id"]

    commit = client.post("/api/ingestion/commit", json={
        "account_id": sample_checking_account.id,
        "statement_file_id": file_id,
        "items": [
            {
                "transaction_date": item["transaction_date"],
                "raw_payee": item["raw_payee"],
                "normalized_payee": item["normalized_payee"],
                "amount": item["amount"],
                "import_hash": item["import_hash"],
            }
            for item in preview["items"]
        ],
    })
    assert commit.status_code == 200
    imported = commit.json()["committed_count"]
    assert imported > 0

    client.delete(f"/api/ingestion/statement-files/{file_id}")

    db_session.expire_all()
    remaining = db_session.query(Transaction).filter(
        Transaction.account_id == sample_checking_account.id
    ).count()
    assert remaining == imported, "removing the source document must not delete ledger history"


def test_deleting_an_unknown_statement_is_a_404(client):
    assert client.delete("/api/ingestion/statement-files/does-not-exist").status_code == 404


def test_deletion_is_confined_to_the_upload_directory(client, db_session, sample_checking_account, tmp_path):
    """A tampered file_path must not let the endpoint unlink arbitrary files."""
    outside = tmp_path / "important.txt"
    outside.write_text("do not delete me")

    stmt = StatementFile(
        account_id=sample_checking_account.id,
        filename="spoofed.csv",
        file_path=str(outside),
        file_hash="0" * 64,
        mime_type="text/csv",
        file_size=1,
    )
    db_session.add(stmt)
    db_session.commit()

    assert client.delete(f"/api/ingestion/statement-files/{stmt.id}").status_code == 204
    assert outside.exists(), "a path outside the upload directory must never be unlinked"
    assert settings.UPLOAD_DIR is not None
