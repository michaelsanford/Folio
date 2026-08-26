from pydantic import BaseModel


class NetWorthPoint(BaseModel):
    date: str
    assets: float
    liabilities: float
    net_worth: float


class CategorySpendPoint(BaseModel):
    category_id: str
    category_name: str
    category_color: str
    category_icon: str | None = None
    amount: float
    percentage: float


class CashFlowSummary(BaseModel):
    total_income: float
    total_expenses: float
    # Movement between the household's own accounts (credit-card payments,
    # savings transfers). Excluded from income and expenses, reported so the
    # volume is visible rather than silently dropped.
    total_transfers: float = 0.0
    net_savings: float
    savings_rate: float


class SankeyNode(BaseModel):
    name: str


class SankeyLink(BaseModel):
    source: int  # Index into nodes
    target: int
    value: float


class SankeyData(BaseModel):
    nodes: list[SankeyNode]
    links: list[SankeyLink]


class DashboardAnalyticsResponse(BaseModel):
    current_net_worth: float
    total_assets: float
    total_liabilities: float
    monthly_cash_flow: CashFlowSummary
    net_worth_history: list[NetWorthPoint]
    category_spending: list[CategorySpendPoint]
    sankey: SankeyData
