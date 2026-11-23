from datetime import datetime, timezone

from app.api.rules import auto_learn_rule, seed_default_rules
from app.models.category import Category
from app.models.rule import CategorizationRule
from app.models.transaction import Transaction, TransactionSplit
from app.services.categorization.engine import ClassificationEngine, ClassificationTier
from app.services.ingestion.csv_parser import parse_csv_content


def _slug_map(db_session) -> dict[str, str]:
    return {c.slug: c.id for c in db_session.query(Category).all()}


def test_seeded_canadian_banking_and_service_rules(db_session):
    seed_default_rules(db_session)
    cats = _slug_map(db_session)

    cases = [
        ("Email Trfs", "E-TRANSFER SENT", -150.0, "internal-transfer", None),
        ("Transfer", "", -300.0, "internal-transfer", None),
        ("WWW TRF DDA - 1111", "", -500.0, "internal-transfer", None),
        ("SCHEDULED PAYMENT", "ONLINE TRANSFER", -250.0, "internal-transfer", None),
        ("MORTGAGE", "FN", -1250.0, "mortgage-principal", None),
        ("LOAN", "VW CREDIT CAN", -410.0, "vehicle-loan-principal", None),
        ("MISC PAYMENT", "RBC CREDIT CARD", -620.0, "cc-payment", None),
        ("AUTOMATIC PAYMENT -THANK YOU", "", 620.0, "cc-payment", None),
        ("MULTIPRODUCT REBATE", "", 11.95, "bank-fees", None),
        ("DEPOSIT INTEREST", "", 2.45, "other-income", None),
        ("Payment", "WWW PAYMENT - 1234 VILLE DE TEST", -380.0, "utilities", None),
        ("SIRIUSXM", "", -14.99, "subscriptions", None),
        ("GOOGLE *AMAZON SHOPPIN", "", -29.99, "shopping", None),
        ("GOOGLE *SOME APP", "", -9.99, "subscriptions", "Some App"),
    ]

    for raw_payee, notes, amount, expected_slug, expected_norm in cases:
        res = ClassificationEngine.classify_transaction(
            db_session,
            raw_payee=raw_payee,
            amount=amount,
            notes=notes or None,
        )
        assert res.matched is True, f"Expected match for {raw_payee} ({notes})"
        assert res.category_id == cats[expected_slug], (
            f"Expected {expected_slug} for {raw_payee} ({notes}), got {res.category_name}"
        )
        if expected_norm is not None:
            assert res.normalized_payee == expected_norm


def test_non_bill_city_names_do_not_match_municipal_utilities(db_session):
    seed_default_rules(db_session)
    cats = _slug_map(db_session)

    walmart = ClassificationEngine.classify_transaction(
        db_session, raw_payee="WALMART BELLEVILLE ON", amount=-42.10
    )
    assert walmart.matched is True
    assert walmart.category_id == cats["groceries"]

    bakery = ClassificationEngine.classify_transaction(
        db_session, raw_payee="BOULANGERIE VILLE MARIE", amount=-18.50
    )
    assert bakery.matched is True
    assert bakery.category_id == cats["restaurants"]


def test_generic_payee_learning_learns_from_notes_and_skips_overbroad_rules(
    db_session, sample_checking_account
):
    cats = _slug_map(db_session)
    health_id = cats["health-medical"]

    # Generic payee with specific note learns the note merchant, never "MISC PAYMENT".
    learned = auto_learn_rule(
        db_session,
        raw_payee="MISC PAYMENT",
        category_id=health_id,
        normalized_payee="Misc Payment",
        notes="ACME FITNESS CLUB",
    )
    assert learned is not None
    assert learned.pattern == "ACME FITNESS CLUB"
    assert learned.normalized_payee_override == "Acme Fitness Club"
    db_session.commit()

    # Add a historical MISC PAYMENT transaction categorized under health-medical.
    hist_txn = Transaction(
        account_id=sample_checking_account.id,
        transaction_date=datetime.now(timezone.utc),
        raw_payee="MISC PAYMENT",
        normalized_payee="Acme Fitness Club",
        notes="ACME FITNESS CLUB",
        amount_cents=-6500,
    )
    db_session.add(hist_txn)
    db_session.flush()
    db_session.add(
        TransactionSplit(
            transaction_id=hist_txn.id,
            category_id=health_id,
            amount_cents=-6500,
        )
    )
    db_session.commit()

    # Future MISC PAYMENT + ACME FITNESS CLUB matches via Tier 1 rule cleanly.
    hit = ClassificationEngine.classify_transaction(
        db_session,
        raw_payee="MISC PAYMENT",
        amount=-65.0,
        account_id=sample_checking_account.id,
        notes="ACME FITNESS CLUB",
    )
    assert hit.matched is True
    assert hit.category_id == health_id
    assert hit.normalized_payee == "Acme Fitness Club"

    # Unrelated MISC PAYMENT must stay UNCLASSIFIED across both Tier 1 and Tier 2 history.
    unrelated = ClassificationEngine.classify_transaction(
        db_session,
        raw_payee="MISC PAYMENT",
        amount=-120.0,
        account_id=sample_checking_account.id,
        notes="UNRELATED VENDOR",
    )
    assert unrelated.matched is False
    assert unrelated.tier == ClassificationTier.UNCLASSIFIED

    # Generic labels with empty or generic/short notes must never create rules.
    before_count = db_session.query(CategorizationRule).count()
    assert auto_learn_rule(db_session, "MISC PAYMENT", health_id, notes="") is None
    assert auto_learn_rule(db_session, "Email Trfs", cats["internal-transfer"], notes="E-TRANSFER SENT") is None
    assert auto_learn_rule(db_session, "MORTGAGE", cats["mortgage-principal"], notes="FN") is None
    db_session.flush()
    assert db_session.query(CategorizationRule).count() == before_count


def test_commit_learns_distinct_rules_for_generic_payee_with_distinct_notes(
    client, db_session, sample_checking_account
):
    cats = _slug_map(db_session)
    before = db_session.query(CategorizationRule).count()

    resp = client.post(
        "/api/ingestion/commit",
        json={
            "account_id": sample_checking_account.id,
            "items": [
                {
                    "transaction_date": "2026-07-10",
                    "raw_payee": "MISC PAYMENT",
                    "normalized_payee": "Misc Payment",
                    "amount": -45.0,
                    "notes": "GYM ALPHA CLUB",
                    "import_hash": "misc-alpha-1",
                    "category_id": cats["health-medical"],
                },
                {
                    "transaction_date": "2026-07-11",
                    "raw_payee": "MISC PAYMENT",
                    "normalized_payee": "Misc Payment",
                    "amount": -80.0,
                    "notes": "DAYCARE BETA CENTER",
                    "import_hash": "misc-beta-1",
                    "category_id": cats["childcare"],
                },
            ],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["committed_count"] == 2
    assert db_session.query(CategorizationRule).count() == before + 2

    patterns = {r.pattern for r in db_session.query(CategorizationRule).all()}
    assert "GYM ALPHA CLUB" in patterns
    assert "DAYCARE BETA CENTER" in patterns
    assert "MISC PAYMENT" not in patterns


def test_auto_classify_and_apply_batch_use_notes(client, db_session, sample_checking_account):
    seed_default_rules(db_session)
    cats = _slug_map(db_session)

    # Transaction 1: auto-classify via /api/classification/auto-classify-uncategorized using notes
    t1 = Transaction(
        account_id=sample_checking_account.id,
        transaction_date=datetime.now(timezone.utc),
        raw_payee="Payment",
        normalized_payee="Payment",
        notes="WWW PAYMENT - 1234 VILLE DE TEST",
        amount_cents=-21000,
    )
    db_session.add(t1)
    db_session.commit()

    cls_resp = client.post(
        "/api/classification/auto-classify-uncategorized",
        json={"dry_run": False, "threshold": 0.70},
    )
    assert cls_resp.status_code == 200
    assert cls_resp.json()["classified_count"] == 1
    db_session.refresh(t1)
    assert t1.splits[0].category_id == cats["utilities"]

    # Transaction 2: apply via /api/rules/apply-batch using notes
    t2 = Transaction(
        account_id=sample_checking_account.id,
        transaction_date=datetime.now(timezone.utc),
        raw_payee="LOAN",
        normalized_payee="Loan",
        notes="VW CREDIT CAN",
        amount_cents=-39500,
    )
    db_session.add(t2)
    db_session.commit()

    batch_resp = client.post("/api/rules/apply-batch")
    assert batch_resp.status_code == 200
    assert batch_resp.json()["applied_count"] == 1
    db_session.refresh(t2)
    assert t2.splits[0].category_id == cats["vehicle-loan-principal"]
    assert t2.normalized_payee == "VW Credit Canada"


def test_multi_account_csv_paired_transfers_suggest_transfer_categories(db_session):
    seed_default_rules(db_session)
    cats = _slug_map(db_session)

    csv_text = (
        "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$\n"
        "Chequing,00001-1111111,07/15/2026,,UNMATCHED XFER OUT,,-250.00,\n"
        "Savings,00001-2222222,07/15/2026,,UNMATCHED XFER IN,,250.00,\n"
        "Chequing,00001-1111111,07/16/2026,,UNMATCHED CC OUT,,-400.00,\n"
        "Visa,450011******9999,07/16/2026,,UNMATCHED CC IN,,400.00,\n"
    )

    preview = parse_csv_content(db_session, None, csv_text, "synthetic_transfers.csv")
    assert len(preview.items) == 4

    # Chequing <-> Savings paired transfer -> internal-transfer
    assert preview.items[0].potential_transfer_account_name is not None
    assert preview.items[0].suggested_category_id == cats["internal-transfer"]
    assert preview.items[1].suggested_category_id == cats["internal-transfer"]

    # Chequing <-> Visa paired transfer -> cc-payment
    assert preview.items[2].potential_transfer_account_name is not None
    assert preview.items[2].suggested_category_id == cats["cc-payment"]
    assert preview.items[3].suggested_category_id == cats["cc-payment"]
