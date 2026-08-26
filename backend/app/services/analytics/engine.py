from datetime import datetime
from dateutil.relativedelta import relativedelta
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit
from app.models.category import Category
from app.core.money import from_cents
from app.services.analytics.classification import split_kind_case
from app.services.snapshots.balance_history import net_worth_series
from app.schemas.analytics import (
    NetWorthPoint,
    CategorySpendPoint,
    CashFlowSummary,
    SankeyNode,
    SankeyLink,
    SankeyData,
    DashboardAnalyticsResponse,
)

ASSET_TYPES = {
    AccountType.CHECKING,
    AccountType.SAVINGS,
    AccountType.INVESTMENT,
    AccountType.OTHER_ASSET,
}

LIABILITY_TYPES = {
    AccountType.CREDIT_CARD,
    AccountType.MORTGAGE,
    AccountType.VEHICLE_LOAN,
    AccountType.OTHER_LIABILITY,
}


def get_dashboard_analytics(
    db: Session,
    year: int | None = None,
    month: int | None = None,
    history_months: int = 12,
) -> DashboardAnalyticsResponse:
    """
    Computes real-time dashboard analytics including Net Worth, Cash Flow, Spend by Category, and Sankey diagram data.
    """
    now = datetime.now()
    target_year = year or now.year
    target_month = month or now.month

    # 1. Accounts & Net Worth
    accounts = db.query(Account).filter(Account.is_active.is_(True)).all()
    assets_cents = sum(a.current_balance_cents for a in accounts if a.type in ASSET_TYPES)
    liabilities_cents = sum(abs(a.current_balance_cents) for a in accounts if a.type in LIABILITY_TYPES)
    net_worth_cents = assets_cents - liabilities_cents

    # Real net worth history from recorded balance snapshots. If an account has
    # no snapshot yet (fresh install, or before the first backfill) it simply does
    # not contribute to that month rather than fabricating a value.
    net_worth_history: list[NetWorthPoint] = [
        NetWorthPoint(date=label, assets=assets, liabilities=liabilities, net_worth=nw)
        for label, assets, liabilities, nw in net_worth_series(
            db, ASSET_TYPES, LIABILITY_TYPES, months=history_months
        )
    ]

    # 2. Monthly Cash Flow (Transactions in target month)
    start_of_month = datetime(target_year, target_month, 1)
    if target_month == 12:
        end_of_month = datetime(target_year + 1, 1, 1)
    else:
        end_of_month = datetime(target_year, target_month + 1, 1)

    # Aggregate in SQL rather than loading every split for the month into Python.
    kind = split_kind_case().label("kind")
    rows = (
        db.query(
            kind,
            TransactionSplit.category_id.label("category_id"),
            Category.name.label("category_name"),
            Category.color.label("category_color"),
            Category.icon.label("category_icon"),
            func.sum(TransactionSplit.amount_cents).label("total_cents"),
            # Gross volume: the two halves of a transfer net to zero, so the
            # signed sum cannot measure how much moved.
            func.sum(func.abs(TransactionSplit.amount_cents)).label("gross_cents"),
        )
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .outerjoin(Category, TransactionSplit.category_id == Category.id)
        .filter(
            Transaction.transaction_date >= start_of_month,
            Transaction.transaction_date < end_of_month,
        )
        .group_by(
            kind,
            TransactionSplit.category_id,
            Category.name,
            Category.color,
            Category.icon,
        )
        .all()
    )

    # Exact integer cents throughout; dollars appear only in the response.
    income_cents = 0
    expenses_cents = 0
    transfers_cents = 0
    category_spend_map: dict[str, dict] = {}

    for row in rows:
        total = row.total_cents or 0
        if row.kind == "TRANSFER":
            # Movement between the household's own accounts is neither earned nor
            # spent. Reported separately so the volume stays visible.
            transfers_cents += row.gross_cents or 0
            continue

        if row.kind == "INCOME":
            # Signed, so a clawback against an income category reduces income.
            income_cents += total
            continue

        # EXPENSE: stored negative, so negate to report as a positive outflow.
        # A refund posted to an expense category is positive and correctly
        # reduces the category total rather than inflating it.
        row_expense_cents = -total
        expenses_cents += row_expense_cents

        cat_id = row.category_id or "uncategorized"
        entry = category_spend_map.setdefault(
            cat_id,
            {
                "id": cat_id,
                "name": row.category_name or "Uncategorized",
                "color": row.category_color or "#9CA3AF",
                "icon": row.category_icon or "tag",
                "cents": 0,
            },
        )
        entry["cents"] += row_expense_cents

    net_savings_cents = income_cents - expenses_cents
    savings_rate = round(
        (net_savings_cents / income_cents * 100.0) if income_cents > 0 else 0.0, 1
    )

    cash_flow = CashFlowSummary(
        total_income=float(from_cents(income_cents)),
        total_expenses=float(from_cents(expenses_cents)),
        total_transfers=float(from_cents(transfers_cents)),
        net_savings=float(from_cents(net_savings_cents)),
        savings_rate=savings_rate,
    )

    # Category spending breakdown (a net-negative category is a refund, not spend)
    category_spending: list[CategorySpendPoint] = []
    for cat_data in sorted(category_spend_map.values(), key=lambda x: x["cents"], reverse=True):
        if cat_data["cents"] <= 0:
            continue
        pct = (cat_data["cents"] / expenses_cents * 100.0) if expenses_cents > 0 else 0.0
        category_spending.append(
            CategorySpendPoint(
                category_id=cat_data["id"],
                category_name=cat_data["name"],
                category_color=cat_data["color"],
                category_icon=cat_data["icon"],
                amount=float(from_cents(cat_data["cents"])),
                percentage=round(pct, 1),
            )
        )

    # 3. Sankey Data Structure
    nodes: list[SankeyNode] = []
    links: list[SankeyLink] = []

    if income_cents > 0:
        nodes.append(SankeyNode(name="Total Income"))  # Node 0
        nodes.append(SankeyNode(name="Expenses"))       # Node 1
        links.append(SankeyLink(source=0, target=1, value=cash_flow.total_expenses))

        if net_savings_cents > 0:
            nodes.append(SankeyNode(name="Net Savings"))  # Node 2
            links.append(SankeyLink(source=0, target=2, value=cash_flow.net_savings))

        # Top 5 categories by spend, with the remainder rolled into "Other" so the
        # outgoing flows sum to the Expenses total instead of silently falling short.
        TOP_N = 5
        for cat_item in category_spending[:TOP_N]:
            cat_node_idx = len(nodes)
            nodes.append(SankeyNode(name=cat_item.category_name))
            links.append(SankeyLink(source=1, target=cat_node_idx, value=cat_item.amount))

        remainder = round(cash_flow.total_expenses - sum(c.amount for c in category_spending[:TOP_N]), 2)
        if remainder > 0.01:
            other_idx = len(nodes)
            nodes.append(SankeyNode(name="Other"))
            links.append(SankeyLink(source=1, target=other_idx, value=remainder))
    else:
        nodes = [SankeyNode(name="No Data")]
        links = []

    sankey = SankeyData(nodes=nodes, links=links)

    return DashboardAnalyticsResponse(
        current_net_worth=float(from_cents(net_worth_cents)),
        total_assets=float(from_cents(assets_cents)),
        total_liabilities=float(from_cents(liabilities_cents)),
        monthly_cash_flow=cash_flow,
        net_worth_history=net_worth_history,
        category_spending=category_spending,
        sankey=sankey,
    )
