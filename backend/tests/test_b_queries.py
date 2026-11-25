"""Query-shape regressions: transfer linking, sorting, N+1s and read-only GETs."""
from datetime import date, datetime, timedelta

from app.models.account import Account, AccountType
from app.models.budget import Budget, BudgetItem
from app.models.category import Category
from app.models.rule import CategorizationRule
from app.models.snapshot import AccountBalanceSnapshot
from app.models.transaction import Transaction, TransactionSplit
from app.services.analytics.engine import ASSET_TYPES, LIABILITY_TYPES
from app.services.categorization.transfer_matcher import link_offsetting_transfers
from app.services.snapshots.balance_history import net_worth_series
from tests.b_query_counter import count_queries


def _account(db, name, acc_type=AccountType.CHECKING):
    acc = Account(name=name, type=acc_type)
    db.add(acc)
    db.flush()
    return acc


def _txn(db, account, when, cents, payee="X", category_id=None):
    txn = Transaction(account_id=account.id, transaction_date=when, raw_payee=payee, amount_cents=cents)
    txn.splits.append(TransactionSplit(amount_cents=cents, category_id=category_id))
    db.add(txn)
    db.flush()
    return txn


# ------------------------------------------------------------------ transfers


def test_scoped_transfer_linking_pairs_only_new_rows(db_session):
    chq = _account(db_session, "Chequing")
    card = _account(db_session, "Visa", AccountType.CREDIT_CARD)
    sav = _account(db_session, "Savings", AccountType.SAVINGS)
    base = datetime(2026, 3, 10)

    # Historical unpaired pair that the scoped pass must leave alone.
    old_out = _txn(db_session, chq, base - timedelta(days=60), -5000)
    old_in = _txn(db_session, sav, base - timedelta(days=60), 5000)
    # Existing card credit waiting for its chequing side.
    card_in = _txn(db_session, card, base + timedelta(days=2), 25000)
    # Noise: same amount, same account (never a transfer), and out of the window.
    _txn(db_session, chq, base, 25000)
    _txn(db_session, sav, base + timedelta(days=5), 25000)
    db_session.commit()

    new_out = _txn(db_session, chq, base, -25000)
    db_session.commit()

    for i in range(200):  # unrelated history must not change the query count
        _txn(db_session, sav, base - timedelta(days=i), -(100 + i))
    db_session.commit()

    with count_queries(db_session) as statements:
        linked, scanned = link_offsetting_transfers(db_session, window_days=3, transaction_ids=[new_out.id])
    assert (linked, scanned) == (1, 1)
    assert len(statements) <= 6, statements

    db_session.expire_all()
    assert db_session.get(Transaction, new_out.id).transfer_transaction_id == card_in.id
    assert db_session.get(Transaction, card_in.id).transfer_transaction_id == new_out.id
    assert db_session.get(Transaction, old_out.id).transfer_transaction_id is None
    assert db_session.get(Transaction, old_in.id).transfer_transaction_id is None


def test_window_boundary_is_inclusive_and_closest_wins(db_session):
    chq = _account(db_session, "Chequing")
    sav = _account(db_session, "Savings", AccountType.SAVINGS)
    base = datetime(2026, 3, 10, 9, 30)
    far = _txn(db_session, sav, base + timedelta(days=3), 7000)        # exactly +3 days
    near = _txn(db_session, sav, base + timedelta(days=1), 7000)
    outside = _txn(db_session, sav, base + timedelta(days=3, seconds=1), 7000)
    out = _txn(db_session, chq, base, -7000)
    db_session.commit()

    linked, _ = link_offsetting_transfers(db_session, transaction_ids=[out.id])
    assert linked == 1
    db_session.expire_all()
    assert db_session.get(Transaction, out.id).transfer_transaction_id == near.id
    assert db_session.get(Transaction, far.id).transfer_transaction_id is None
    assert db_session.get(Transaction, outside.id).transfer_transaction_id is None

    # The +3 day row is still pairable on its own.
    out2 = _txn(db_session, chq, base, -7000)
    db_session.commit()
    assert link_offsetting_transfers(db_session, transaction_ids=[out2.id])[0] == 1
    db_session.expire_all()
    assert db_session.get(Transaction, out2.id).transfer_transaction_id == far.id


def test_full_scan_mode_links_history(db_session):
    chq = _account(db_session, "Chequing")
    sav = _account(db_session, "Savings", AccountType.SAVINGS)
    base = datetime(2026, 1, 1)
    for i in range(5):
        _txn(db_session, chq, base + timedelta(days=10 * i), -(1000 + i))
        _txn(db_session, sav, base + timedelta(days=10 * i + 1), 1000 + i)
    db_session.commit()

    linked, scanned = link_offsetting_transfers(db_session, window_days=3)
    assert linked == 5
    assert scanned == 10
    assert link_offsetting_transfers(db_session, window_days=3) == (0, 0)


# ------------------------------------------------------------------ transactions


def test_sort_by_amount(client, db_session):
    acc = _account(db_session, "Chequing")
    for cents in (-500, 2500, -12000, 100):
        _txn(db_session, acc, datetime(2026, 3, 1), cents)
    db_session.commit()

    desc = client.get("/api/transactions?sort_by=amount&sort_order=desc")
    assert desc.status_code == 200
    assert [t["amount"] for t in desc.json()["items"]] == [25.0, 1.0, -5.0, -120.0]
    asc = client.get("/api/transactions?sort_by=amount&sort_order=asc").json()
    assert [t["amount"] for t in asc["items"]] == [-120.0, -5.0, 1.0, 25.0]


def test_batch_categorize_query_count_is_flat(client, db_session):
    acc = _account(db_session, "Chequing")
    groceries = db_session.query(Category).filter(Category.slug == "groceries").first()
    ids = [_txn(db_session, acc, datetime(2026, 3, 1), -100 - i, payee=f"SHOP {i}").id for i in range(40)]
    db_session.commit()

    with count_queries(db_session) as statements:
        resp = client.post("/api/transactions/batch-categorize", json={
            "transaction_ids": ids,
            "category_id": groceries.id,
        })
    assert resp.status_code == 200
    assert resp.json()["updated_count"] == 40
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
    # +1: the closed-year boundary (one query, shared with the flush check).
    assert len(selects) <= 9, selects
    assert db_session.query(CategorizationRule).filter(CategorizationRule.pattern.like("SHOP%")).count() == 40


def test_apply_batch_only_touches_uncategorized(client, db_session):
    from app.api.rules import seed_default_rules

    seed_default_rules(db_session)
    acc = _account(db_session, "Chequing")
    restaurants = db_session.query(Category).filter(Category.slug == "restaurants").first()
    already = _txn(db_session, acc, datetime(2026, 3, 1), -1500, payee="TIM HORTONS #1", category_id=restaurants.id)
    loose = _txn(db_session, acc, datetime(2026, 3, 1), -1500, payee="TIM HORTONS #2")
    db_session.commit()

    resp = client.post("/api/rules/apply-batch")
    assert resp.status_code == 200
    assert resp.json()["applied_count"] == 1
    db_session.expire_all()
    assert db_session.get(Transaction, already.id).splits[0].category_id == restaurants.id
    assert db_session.get(Transaction, loose.id).splits[0].category_id is not None


def test_auto_classify_scopes_to_uncategorized(client, db_session):
    acc = _account(db_session, "Chequing")
    groceries = db_session.query(Category).filter(Category.slug == "groceries").first()
    _txn(db_session, acc, datetime(2026, 3, 1), -1500, payee="ALREADY DONE", category_id=groceries.id)
    _txn(db_session, acc, datetime(2026, 3, 1), 250000, payee="ACME PAYROLL")
    db_session.commit()

    resp = client.post("/api/classification/auto-classify-uncategorized", json={"dry_run": True})
    assert resp.status_code == 200
    assert resp.json()["total_uncategorized"] == 1


# ------------------------------------------------------------------ net worth


def test_net_worth_series_is_one_query_per_call(db_session):
    accounts = [_account(db_session, f"A{i}") for i in range(6)]
    today = date.today()
    for acc in accounts:
        for m in range(14):
            db_session.add(AccountBalanceSnapshot(
                account_id=acc.id, as_of_date=today - timedelta(days=30 * m), balance_cents=1000 * (m + 1),
            ))
    db_session.commit()

    with count_queries(db_session) as statements:
        points = net_worth_series(db_session, ASSET_TYPES, LIABILITY_TYPES, months=12)
    assert len(points) == 12
    assert len(statements) <= 2, statements  # accounts + one grouped snapshot query
    # Latest point carries the most recent snapshot of every account.
    assert points[-1][1] == 6 * 10.0


def test_net_worth_carries_last_balance_forward(db_session):
    acc = _account(db_session, "Savings", AccountType.SAVINGS)
    today = date.today()
    first_of_month = today.replace(day=1)
    two_months_back = (first_of_month - timedelta(days=40)).replace(day=5)
    db_session.add(AccountBalanceSnapshot(account_id=acc.id, as_of_date=two_months_back, balance_cents=12345))
    db_session.commit()
    points = net_worth_series(db_session, ASSET_TYPES, LIABILITY_TYPES, months=4)
    assert [p[1] for p in points][-3:] == [123.45, 123.45, 123.45]


# ------------------------------------------------------------------ budgets


def test_budget_gets_do_not_write(client, db_session):
    with count_queries(db_session) as statements:
        current = client.get("/api/budgets/current")
        month = client.get("/api/budgets/2026/4")
    assert current.status_code == 200 and month.status_code == 200
    writes = [s for s in statements if s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
    assert writes == []
    assert db_session.query(Budget).count() == 0
    assert db_session.query(BudgetItem).count() == 0
    assert len(month.json()["items"]) > 0, "budgeted categories are still listed"


def test_virtual_budget_id_is_stable_and_writable(client, db_session):
    view = client.get("/api/budgets/2026/6").json()
    cat_id = view["items"][0]["category_id"]
    resp = client.put(f"/api/budgets/{view['id']}", json={
        "total_expense_target": 1200.0,
        "items": [{"category_id": cat_id, "planned_amount": 300.0}],
    })
    assert resp.status_code == 200
    saved = resp.json()
    assert saved["id"] == view["id"]
    assert saved["total_expense_target"] == 1200.0
    assert client.get("/api/budgets/2026/6").json()["id"] == view["id"]

    # Deleting from a never-saved month is a no-op, not a 404.
    other = client.get("/api/budgets/2026/7").json()
    assert client.delete(f"/api/budgets/{other['id']}/items/{cat_id}").status_code == 200
    assert client.put("/api/budgets/not-a-budget", json={}).status_code == 404


def test_rollover_chain_spans_several_months(client, db_session):
    acc = _account(db_session, "Chequing")
    cat = db_session.query(Category).filter(Category.slug == "groceries").first()
    cat.is_rollover = True
    cat.is_budgeted = True
    db_session.commit()
    for month in (1, 2, 3):
        client.post(f"/api/budgets/2026/{month}/items", json={"category_id": cat.id, "planned_amount": 100.0})
    _txn(db_session, acc, datetime(2026, 1, 10), -6000, category_id=cat.id)   # Jan: 100 - 60 = +40
    _txn(db_session, acc, datetime(2026, 2, 10), -12000, category_id=cat.id)  # Feb: 100 + 40 - 120 = +20
    db_session.commit()

    # March is read without January or February ever having been opened.
    with count_queries(db_session) as statements:
        march = client.get("/api/budgets/2026/3").json()
    item = next(i for i in march["items"] if i["category_id"] == cat.id)
    assert item["rollover_amount"] == 20.0
    assert item["available_amount"] == 120.0
    assert len(statements) <= 10, statements
