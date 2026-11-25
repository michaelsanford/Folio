import uuid
from datetime import datetime, timezone
import enum
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Enum, ForeignKey, Index, Table
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.attribution import AttributedMixin
from app.core.config import settings
from app.models.money_fields import with_money


class AccountVisibility(str, enum.Enum):
    """Who may see an account (core/visibility.py). NULL in the database is HOUSEHOLD."""

    HOUSEHOLD = "HOUSEHOLD"  # everyone sees it and its transactions
    TOTALS = "TOTALS"  # others count it in household totals, without details
    PRIVATE = "PRIVATE"  # only its owners know it exists


# Which household members own an account (one or more; none is allowed).
account_owners = Table(
    "account_owners",
    Base.metadata,
    Column("account_id", String(36), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
    Column("member_id", String(36), ForeignKey("household_members.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_account_owners_member_id", "member_id"),
)


class LoanCompounding(str, enum.Enum):
    """How often interest is compounded on a loan.

    Canadian fixed-rate mortgages are compounded semi-annually, not in advance
    (Interest Act, s.6); US mortgages compound monthly. Using the US convention
    for a Canadian mortgage overstates interest by thousands over the term.
    """

    MONTHLY = "MONTHLY"
    SEMI_ANNUAL = "SEMI_ANNUAL"


class AccountType(str, enum.Enum):
    # Banking / Cash
    CHECKING = "CHECKING"
    SAVINGS = "SAVINGS"
    HISA = "HISA"
    CASH = "CASH"

    # Registered Accounts (Canada)
    TFSA = "TFSA"
    RRSP = "RRSP"
    FHSA = "FHSA"
    RESP = "RESP"
    RDSP = "RDSP"
    RRIF = "RRIF"
    LIRA = "LIRA"
    LIF = "LIF"
    IPP = "IPP"

    # Non-Registered Investments
    INVESTMENT = "INVESTMENT"
    NON_REGISTERED = "NON_REGISTERED"
    CRYPTO = "CRYPTO"

    # Credit & Debt / Liabilities
    CREDIT_CARD = "CREDIT_CARD"
    LINE_OF_CREDIT = "LINE_OF_CREDIT"
    MORTGAGE = "MORTGAGE"
    VEHICLE_LOAN = "VEHICLE_LOAN"
    STUDENT_LOAN = "STUDENT_LOAN"
    PERSONAL_LOAN = "PERSONAL_LOAN"
    OTHER_LIABILITY = "OTHER_LIABILITY"

    # Real & Other Assets
    REAL_ESTATE = "REAL_ESTATE"
    VEHICLE_ASSET = "VEHICLE_ASSET"
    OTHER_ASSET = "OTHER_ASSET"


# Revolving credit has no maturity or original principal; its balance moves up
# and down and the lender only requires a minimum payment.
REVOLVING_TYPES = frozenset({AccountType.LINE_OF_CREDIT})

# Money owed rather than owned.
LIABILITY_TYPES = frozenset({
    AccountType.CREDIT_CARD,
    AccountType.LINE_OF_CREDIT,
    AccountType.MORTGAGE,
    AccountType.VEHICLE_LOAN,
    AccountType.STUDENT_LOAN,
    AccountType.PERSONAL_LOAN,
    AccountType.OTHER_LIABILITY,
})


def balance_from_ledger_cents(account_type: "AccountType", ledger_sum_cents: int) -> int:
    """An account's balance from the sum of its transactions.

    Transactions keep cash-flow signs on every account: a card purchase is
    negative (spending) and a payment to the card is positive. A liability's
    balance, though, is the amount owed, positive while money is owed, so its
    ledger sum is negated. An overpaid card therefore shows a negative balance
    (a credit).
    """
    return -ledger_sum_cents if account_type in LIABILITY_TYPES else ledger_sum_cents


@with_money(
    current_balance=False,
    credit_limit=True,
    loan_original_principal=True,
    monthly_payment=True,
    escrow_payment=True,
)
class Account(AttributedMixin, Base):
    __tablename__ = "accounts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    type = Column(Enum(AccountType, native_enum=False), nullable=False)
    institution = Column(String(100), nullable=True)
    account_number_mask = Column(String(20), nullable=True)
    icon = Column(String(50), nullable=True)
    color = Column(String(20), nullable=True)
    currency = Column(String(3), nullable=False, default=settings.DEFAULT_CURRENCY)
    current_balance_cents = Column(Integer, nullable=False, default=0)
    
    # Credit Card specific
    credit_limit_cents = Column(Integer, nullable=True)
    
    # Loan / Mortgage specific
    interest_rate = Column(Float, nullable=True)  # Annual percentage rate, e.g. 6.5
    loan_origination_date = Column(DateTime, nullable=True)
    loan_term_months = Column(Integer, nullable=True)
    loan_original_principal_cents = Column(Integer, nullable=True)
    monthly_payment_cents = Column(Integer, nullable=True)
    escrow_payment_cents = Column(Integer, nullable=True)  # Property tax + insurance portion
    # Revolving lines only: minimum payment as a percentage of the outstanding
    # balance. NULL means the minimum is interest-only.
    minimum_payment_percent = Column(Float, nullable=True)
    compounding = Column(
        Enum(LoanCompounding, native_enum=False), nullable=False, default=LoanCompounding.MONTHLY
    )
    
    # AccountVisibility value; NULL means HOUSEHOLD.
    visibility = Column(String(16), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    owners = relationship(
        "HouseholdMember", secondary=account_owners, back_populates="accounts", order_by="HouseholdMember.name"
    )
    transactions = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")
    statement_files = relationship("StatementFile", back_populates="account", passive_deletes=True)
    balance_snapshots = relationship("AccountBalanceSnapshot", back_populates="account", cascade="all, delete-orphan")
    holdings = relationship("Holding", back_populates="account", cascade="all, delete-orphan")
    investment_activities = relationship("InvestmentActivity", back_populates="account", cascade="all, delete-orphan")

    @property
    def owner_member_ids(self) -> list[str]:
        return [m.id for m in self.owners]

    @property
    def owner_names(self) -> list[str]:
        return [m.name for m in self.owners]

    @property
    def effective_visibility(self) -> AccountVisibility:
        try:
            return AccountVisibility(self.visibility) if self.visibility else AccountVisibility.HOUSEHOLD
        except ValueError:
            return AccountVisibility.PRIVATE
