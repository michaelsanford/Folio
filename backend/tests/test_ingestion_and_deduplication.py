import io


def test_csv_upload_preview_and_commit(client, sample_checking_account):
    csv_data = (
        "Date,Description,Amount\n"
        "2026-08-01,Whole Foods Market,-85.40\n"
        "2026-08-02,Starbucks,-6.75\n"
        "2026-08-03,Payroll Direct Deposit,3200.00\n"
    )

    # 1. Upload preview
    response = client.post(
        "/api/ingestion/upload-preview",
        data={"account_id": sample_checking_account.id},
        files={"file": ("test_statement.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")},
    )
    assert response.status_code == 200
    preview = response.json()
    assert preview["total_parsed"] == 3
    assert preview["duplicates_count"] == 0
    assert len(preview["items"]) == 3

    # 2. Commit batch
    commit_payload = {
        "account_id": sample_checking_account.id,
        "statement_file_id": preview["file_id"],
        "items": [
            {
                "transaction_date": it["transaction_date"],
                "raw_payee": it["raw_payee"],
                "normalized_payee": it["normalized_payee"],
                "amount": it["amount"],
                "category_id": it["suggested_category_id"],
                "import_hash": it["import_hash"],
            }
            for it in preview["items"]
        ],
    }

    commit_resp = client.post("/api/ingestion/commit", json=commit_payload)
    assert commit_resp.status_code == 200
    commit_data = commit_resp.json()
    assert commit_data["committed_count"] == 3

    # 3. Test re-uploading duplicate statement
    dup_resp = client.post(
        "/api/ingestion/upload-preview",
        data={"account_id": sample_checking_account.id},
        files={"file": ("test_statement.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")},
    )
    assert dup_resp.status_code == 200
    dup_preview = dup_resp.json()
    assert dup_preview["duplicates_count"] == 3
    assert dup_preview["new_count"] == 0
    assert all(it["is_duplicate"] is True for it in dup_preview["items"])


def test_commit_edge_cases_and_resilience(client, sample_checking_account):
    """Tests committing items with empty categories, duplicate in-batch hashes, and ISO timestamps."""
    commit_payload = {
        "account_id": sample_checking_account.id,
        "statement_file_id": "",  # Empty statement_file_id
        "items": [
            {
                "transaction_date": "2026-08-15T14:30:00.000Z",
                "raw_payee": "JEAN COUTU #142",
                "normalized_payee": "Jean Coutu",
                "amount": -22.50,
                "category_id": "",  # Empty string category_id
                "import_hash": "hash_edge_1",
            },
            {
                "transaction_date": "2026-08-15",
                "raw_payee": "JEAN COUTU #142",
                "normalized_payee": "Jean Coutu",
                "amount": -22.50,
                "category_id": None,
                "import_hash": "hash_edge_1",  # Same in-batch hash
            },
            {
                "transaction_date": "2026-08-16",
                "raw_payee": "BOUSTAN",
                "normalized_payee": "Boustan",
                "amount": -18.75,
                "category_id": "non-existent-uuid",  # Non-existent category
                "import_hash": "hash_edge_2",
            },
        ],
    }

    commit_resp = client.post("/api/ingestion/commit", json=commit_payload)
    assert commit_resp.status_code == 200
    commit_data = commit_resp.json()
    assert commit_data["committed_count"] == 2  # 1st unique + 3rd unique (duplicate in batch skipped)
