from datetime import datetime
from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session
from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit
from app.models.category import Category, CategoryType
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


def get_dashboard_analytics(db: Session, year: int | None = None, month: int | None = None) -> DashboardAnalyticsResponse:
    """
    Computes real-time dashboard analytics including Net Worth, Cash Flow, Spend by Category, and Sankey diagram data.
    """
    now = datetime.now()
    target_year = year or now.year
    target_month = month or now.month

    # 1. Accounts & Net Worth
    accounts = db.query(Account).filter(Account.is_active.is_(True)).all()
    total_assets = sum(acc.current_balance for acc in accounts if acc.type in ASSET_TYPES)
    total_liabilities = sum(abs(acc.current_balance) for acc in accounts if acc.type in LIABILITY_TYPES)
    net_worth = total_assets - total_liabilities

    # Generate 6-month net worth history
    net_worth_history: list[NetWorthPoint] = []
    for i in range(5, -1, -1):
        hist_date = now - relativedelta(months=i)
        date_label = hist_date.strftime("%b %Y")
        # In a real app, historical balances can be tracked via ledger running totals;
        # here we build the timeline from current snapshot
        net_worth_history.append(
            NetWorthPoint(
                date=date_label,
                assets=round(total_assets, 2),
                liabilities=round(total_liabilities, 2),
                net_worth=round(net_worth, 2),
            )
        )

    # 2. Monthly Cash Flow (Transactions in target month)
    start_of_month = datetime(target_year, target_month, 1)
    if target_month == 12:
        end_of_month = datetime(target_year + 1, 1, 1)
    else:
        end_of_month = datetime(target_year, target_month + 1, 1)

    # Fetch splits for this month
    splits_with_cats = (
        db.query(TransactionSplit, Transaction, Category)
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .outerjoin(Category, TransactionSplit.category_id == Category.id)
        .filter(
            Transaction.transaction_date >= start_of_month,
            Transaction.transaction_date < end_of_month,
        )
        .all()
    )

    total_income = 0.0
    total_expenses = 0.0
    category_spend_map: dict[str, dict] = {}

    for split, trn, cat in splits_with_cats:
        amt = split.amount
        cat_type = cat.type if cat else (CategoryType.INCOME if amt > 0 else CategoryType.EXPENSE)
        
        if cat_type == CategoryType.INCOME or amt > 0:
            total_income += abs(amt)
        elif cat_type == CategoryType.EXPENSE or amt < 0:
            expense_amt = abs(amt)
            total_expenses += expense_amt
            cat_id = cat.id if cat else "uncategorized"
            cat_name = cat.name if cat else "Uncategorized"
            cat_color = cat.color if cat else "#9CA3AF"
            cat_icon = cat.icon if cat else "tag"

            if cat_id not in category_spend_map:
                category_spend_map[cat_id] = {
                    "id": cat_id,
                    "name": cat_name,
                    "color": cat_color,
                    "icon": cat_icon,
                    "amount": 0.0,
                }
            category_spend_map[cat_id]["amount"] += expense_amt

    net_savings = total_income - total_expenses
    savings_rate = round((net_savings / total_income * 100.0) if total_income > 0 else 0.0, 1)

    cash_flow = CashFlowSummary(
        total_income=round(total_income, 2),
        total_expenses=round(total_expenses, 2),
        net_savings=round(net_savings, 2),
        savings_rate=savings_rate,
    )

    # Category spending breakdown
    category_spending: list[CategorySpendPoint] = []
    for cat_data in sorted(category_spend_map.values(), key=lambda x: x["amount"], reverse=True):
        pct = (cat_data["amount"] / total_expenses * 100.0) if total_expenses > 0 else 0.0
        category_spending.append(
            CategorySpendPoint(
                category_id=cat_data["id"],
                category_name=cat_data["name"],
                category_color=cat_data["color"],
                category_icon=cat_data["icon"],
                amount=round(cat_data["amount"], 2),
                percentage=round(pct, 1),
            )
        )

    # 3. Sankey Data Structure
    nodes: list[SankeyNode] = []
    links: list[SankeyLink] = []

    if total_income > 0:
        nodes.append(SankeyNode(name="Total Income"))  # Node 0
        nodes.append(SankeyNode(name="Expenses"))       # Node 1
        links.append(SankeyLink(source=0, target=1, value=round(total_expenses, 2)))

        if net_savings > 0:
            nodes.append(SankeyNode(name="Net Savings"))  # Node 2
            links.append(SankeyLink(source=0, target=2, value=round(net_savings, 2)))

        # Add top 5 spending categories under Expenses
        for idx, cat_item in enumerate(category_spending[:5]):
            cat_node_idx = len(nodes)
            nodes.append(SankeyNode(name=cat_item.category_name))
            links.append(SankeyLink(source=1, target=cat_node_idx, value=cat_item.amount))
    else:
        nodes = [SankeyNode(name="No Data")]
        links = []

    sankey = SankeyData(nodes=nodes, links=links)

    return DashboardAnalyticsResponse(
        current_net_worth=round(net_worth, 2),
        total_assets=round(total_assets, 2),
        total_liabilities=round(total_liabilities, 2),
        monthly_cash_flow=cash_flow,
        net_worth_history=net_worth_history,
        category_spending=category_spending,
        sankey=sankey,
    )
