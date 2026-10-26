from datetime import date, datetime
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.money import from_cents
from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.household import HouseholdMember
from app.models.transaction import Transaction, TransactionSplit
from app.schemas.goal import (
    CraLimitInfo,
    CraSummaryResponse,
    EmergencyFundCalcResponse,
    EmergencyFundCategoryBreakdown,
)

# Official CRA annual statutory contribution limits
TFSA_ANNUAL_LIMITS = {
    2023: 6500.0,
    2024: 7000.0,
    2025: 7000.0,
    2026: 7000.0,
}

FHSA_ANNUAL_LIMIT = 8000.0
FHSA_LIFETIME_LIMIT = 40000.0


def calculate_emergency_fund(
    db: Session,
    months: int = 6,
    lookback_months: int = 6,
    excluded_category_ids: list[str] | None = None,
) -> EmergencyFundCalcResponse:
    """
    Computes household emergency fund target based on trailing actual expenditures.
    Supports hypothetical discretionary exclusions (e.g., removing Dining, Shopping,
    and Travel to model a lean survival emergency fund).
    """
    excluded_set = set(excluded_category_ids or [])
    today = date.today()

    # Lookback boundary
    # Go back `lookback_months`
    start_year = today.year
    start_month = today.month - lookback_months
    while start_month <= 0:
        start_month += 12
        start_year -= 1
    start_date = datetime(start_year, start_month, 1)

    # Fetch spending by category over the lookback window
    # Exclude internal transfers
    query = (
        db.query(
            TransactionSplit.category_id,
            Category.name,
            Category.color,
            Category.type,
            func.sum(TransactionSplit.amount_cents).label("total_cents"),
        )
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .outerjoin(Category, TransactionSplit.category_id == Category.id)
        .filter(
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= datetime.now(),
            Transaction.transfer_transaction_id.is_(None),  # Exclude transfers
        )
        .group_by(TransactionSplit.category_id)
    )

    rows = query.all()
    categories_breakdown: list[EmergencyFundCategoryBreakdown] = []
    included_cents = 0
    total_spent_cents = 0

    for cat_id, cat_name, cat_color, cat_type, total_cents in rows:
        if cat_type == CategoryType.INCOME or cat_type == CategoryType.TRANSFER:
            continue

        # Expenses are negative cents; make positive for spend magnitude
        spent_cents = abs(total_cents or 0)
        total_spent_cents += spent_cents
        is_excl = (cat_id in excluded_set) if cat_id else False

        if not is_excl:
            included_cents += spent_cents

        spent_dollars = float(from_cents(spent_cents))
        monthly_avg = round(spent_dollars / float(lookback_months), 2)

        categories_breakdown.append(
            EmergencyFundCategoryBreakdown(
                category_id=cat_id or "uncategorized",
                category_name=cat_name or "Uncategorized Expenses",
                category_color=cat_color or "#94A3B8",
                total_spent=spent_dollars,
                monthly_average=monthly_avg,
                is_excluded=is_excl,
            )
        )

    categories_breakdown.sort(key=lambda c: c.total_spent, reverse=True)

    included_dollars = float(from_cents(included_cents))
    monthly_fixed = round(included_dollars / float(lookback_months), 2)
    suggested = round(monthly_fixed * float(months), 2)
    total_spent_dollars = float(from_cents(total_spent_cents))

    avg_total = round(total_spent_dollars / float(lookback_months), 2) if lookback_months > 0 else 0.0
    return EmergencyFundCalcResponse(
        months=months,
        lookback_months=lookback_months,
        monthly_fixed_expense=monthly_fixed,
        suggested_target=suggested,
        total_spent_in_period=total_spent_dollars,
        categories=categories_breakdown,
        months_selected=months,
        monthly_average_included_expense=monthly_fixed,
        suggested_target_amount=suggested,
        monthly_average_total_expense=avg_total,
        category_breakdown=categories_breakdown,
        excluded_category_ids=list(excluded_set),
    )


def get_cra_contribution_summary(
    db: Session,
    year: int | None = None,
    member_id: str | None = None,
) -> CraSummaryResponse:
    """
    Calculates year-to-date contributions against CRA statutory limits for TFSA and FHSA accounts.
    Segments by household member so spousal/partner individual limits are tracked independently.
    """
    target_year = year or date.today().year
    year_start = datetime(target_year, 1, 1)
    year_end = datetime(target_year, 12, 31, 23, 59, 59)

    tfsa_annual_limit = TFSA_ANNUAL_LIMITS.get(target_year, 7000.0)

    # 1. Query all TFSA and FHSA accounts
    q = db.query(Account).filter(Account.type.in_([AccountType.TFSA, AccountType.FHSA]), Account.is_active.is_(True))
    if member_id:
        q = q.filter(Account.owner_member_id == member_id)
    registered_accounts = q.all()

    members = {m.id: m for m in db.query(HouseholdMember).all()}

    # Group accounts by (account_type, owner_member_id)
    grouped: dict[tuple[AccountType, str | None], list[Account]] = {}
    for acc in registered_accounts:
        key = (acc.type, acc.owner_member_id)
        grouped.setdefault(key, []).append(acc)

    limits_info: list[CraLimitInfo] = []

    for (acc_type, member_id), acc_list in grouped.items():
        acc_ids = [a.id for a in acc_list]
        member_name = members[member_id].name if member_id and member_id in members else "Household"

        # Sum net inflows (deposits / contributions) in target year
        # Inflows are positive amounts
        ytd_cents = (
            db.query(func.sum(Transaction.amount_cents))
            .filter(
                Transaction.account_id.in_(acc_ids),
                Transaction.transaction_date >= year_start,
                Transaction.transaction_date <= year_end,
                Transaction.amount_cents > 0,
            )
            .scalar()
        ) or 0

        ytd_dollars = float(from_cents(ytd_cents))

        if acc_type == AccountType.TFSA:
            annual_limit = tfsa_annual_limit
            remaining = max(0.0, annual_limit - ytd_dollars)
            is_over = ytd_dollars > annual_limit
            limits_info.append(
                CraLimitInfo(
                    account_type="TFSA",
                    annual_limit=annual_limit,
                    year_to_date_contributions=ytd_dollars,
                    remaining_annual_room=remaining,
                    is_over_limit=is_over,
                    notes=f"{target_year} Statutory TFSA annual room: ${annual_limit:,.0f} CAD.",
                    owner_member_id=member_id,
                    owner_member_name=member_name,
                )
            )
        elif acc_type == AccountType.FHSA:
            annual_limit = FHSA_ANNUAL_LIMIT
            remaining = max(0.0, annual_limit - ytd_dollars)
            is_over = ytd_dollars > annual_limit

            # Calculate lifetime contributions across all years
            lifetime_cents = (
                db.query(func.sum(Transaction.amount_cents))
                .filter(
                    Transaction.account_id.in_(acc_ids),
                    Transaction.amount_cents > 0,
                )
                .scalar()
            ) or 0
            lifetime_dollars = float(from_cents(lifetime_cents))

            limits_info.append(
                CraLimitInfo(
                    account_type="FHSA",
                    annual_limit=annual_limit,
                    year_to_date_contributions=ytd_dollars,
                    remaining_annual_room=remaining,
                    is_over_limit=is_over,
                    lifetime_limit=FHSA_LIFETIME_LIMIT,
                    total_lifetime_contributions=lifetime_dollars,
                    notes=f"{target_year} Statutory FHSA annual room: ${annual_limit:,.0f} CAD ($40k lifetime).",
                    owner_member_id=member_id,
                    owner_member_name=member_name,
                )
            )

    tfsa_contrib = sum(l.year_to_date_contributions for l in limits_info if l.account_type == "TFSA")
    fhsa_contrib = sum(l.year_to_date_contributions for l in limits_info if l.account_type == "FHSA")
    tfsa_rem = max(0.0, tfsa_annual_limit - tfsa_contrib)
    fhsa_rem = max(0.0, FHSA_ANNUAL_LIMIT - fhsa_contrib)

    return CraSummaryResponse(
        year=target_year,
        tax_year=target_year,
        tfsa_annual_limit=tfsa_annual_limit,
        fhsa_annual_limit=FHSA_ANNUAL_LIMIT,
        fhsa_lifetime_limit=FHSA_LIFETIME_LIMIT,
        tfsa_contributed=round(tfsa_contrib, 2),
        tfsa_remaining_room=round(tfsa_rem, 2),
        fhsa_contributed=round(fhsa_contrib, 2),
        fhsa_remaining_room=round(fhsa_rem, 2),
        notes=f"{target_year} Canadian Statutory CRA Limits: TFSA ${tfsa_annual_limit:,.0f}/yr; FHSA ${FHSA_ANNUAL_LIMIT:,.0f}/yr.",
        limits=limits_info,
    )
