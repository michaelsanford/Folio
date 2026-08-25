from app.services.ingestion.csv_parser import clean_amount_str, auto_detect_csv_columns, parse_csv_content
from app.services.ingestion.deduplication import generate_transaction_hash
from app.api.categories import seed_default_categories
from app.api.rules import seed_default_rules


def test_clean_amount_parsing():
    assert clean_amount_str("$1,234.56") == 1234.56
    assert clean_amount_str("(50.00)") == -50.00
    assert clean_amount_str("- $12.34") == -12.34
    assert clean_amount_str("-19.47") == -19.47
    assert clean_amount_str("19,47") == 19.47
    assert clean_amount_str("0.00") == 0.0
    assert clean_amount_str("") == 0.0
    # Guard against parsing dates as amounts
    assert clean_amount_str("6/27/2026") == 0.0
    assert clean_amount_str("2026-06-27") == 0.0


def test_auto_detect_csv_columns():
    headers = ["Posting Date", "Merchant Name", "Debit", "Credit", "Reference"]
    mapping = auto_detect_csv_columns(headers)
    assert mapping.date_column == "Posting Date"
    assert mapping.payee_column == "Merchant Name"
    assert mapping.debit_column == "Debit"
    assert mapping.credit_column == "Credit"


def test_rbc_and_canadian_bank_csv_parsing(db_session, sample_checking_account):
    """Tests the exact RBC / Canadian bank multi-currency header format."""
    seed_default_categories(db_session)
    seed_default_rules(db_session)

    csv_data = (
        "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$\n"
        "Visa,4514xxxxxxxxxxxxxxxxx,6/27/2026,,BOUSTAN GREENFIELD PARK GREENFIELD PA,,-19.47,\n"
        "Visa,4514xxxxxxxxxxxxxxxxx,6/28/2026,,JEAN COUTU #142,,,-25.50\n"
    )
    result = parse_csv_content(db_session, sample_checking_account.id, csv_data, "rbc_statement.csv")
    assert len(result.items) == 2
    
    # 1st row (CAD$)
    assert result.items[0].transaction_date == "2026-06-27"
    assert result.items[0].raw_payee == "BOUSTAN GREENFIELD PARK GREENFIELD PA"
    assert result.items[0].normalized_payee == "Boustan"
    assert result.items[0].amount == -19.47
    assert result.items[0].suggested_category_name == "Restaurants & Takeout"

    # 2nd row (USD$)
    assert result.items[1].transaction_date == "2026-06-28"
    assert result.items[1].raw_payee == "JEAN COUTU #142"
    assert result.items[1].normalized_payee == "Jean Coutu"
    assert result.items[1].amount == -25.50
    assert result.items[1].suggested_category_name == "Health & Medical"


def test_csv_statement_parsing(db_session, sample_checking_account):
    csv_data = """Date,Description,Amount
2026-08-01,Starbucks,-5.75
2026-08-02,Whole Foods,-45.20
2026-08-03,Direct Deposit,3500.00
"""
    result = parse_csv_content(db_session, sample_checking_account.id, csv_data, "test.csv")
    assert len(result.items) == 3
    assert result.items[0].raw_payee == "Starbucks"
    assert result.items[0].amount == -5.75
    assert result.items[2].raw_payee == "Direct Deposit"
    assert result.items[2].amount == 3500.00


def test_deduplication_fingerprint_generation():
    fp1 = generate_transaction_hash(
        account_id="acc-123",
        date_str="2026-08-10",
        amount=-50.00,
        raw_payee="Shell Oil",
    )
    fp2 = generate_transaction_hash(
        account_id="acc-123",
        date_str="2026-08-10",
        amount=-50.00,
        raw_payee="Shell Oil",
    )
    fp3 = generate_transaction_hash(
        account_id="acc-123",
        date_str="2026-08-11",
        amount=-50.00,
        raw_payee="Shell Oil",
    )

    assert fp1 == fp2
    assert fp1 != fp3
    assert len(fp1) == 64  # SHA-256 hex string
