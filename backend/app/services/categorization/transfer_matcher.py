from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.transaction import Transaction
from app.models.account import Account


class TransferMatch:
    def __init__(self, account_id: str, account_name: str, transaction_id: str | None = None):
        self.account_id = account_id
        self.account_name = account_name
        self.transaction_id = transaction_id


def find_potential_transfers(
    db: Session,
    current_account_id: str,
    transaction_date: datetime,
    amount: float,
    window_days: int = 3,
) -> TransferMatch | None:
    """
    Searches for an opposing transaction in other accounts within ±window_days.
    e.g. If current transaction is -$500, looks for an existing +$500 transaction in another account.
    """
    opposing_amount = -amount
    start_date = transaction_date - timedelta(days=window_days)
    end_date = transaction_date + timedelta(days=window_days)

    # Search existing transactions in other accounts
    match = (
        db.query(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .filter(
            Transaction.account_id != current_account_id,
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
            Transaction.amount.between(opposing_amount - 0.01, opposing_amount + 0.01),
            Transaction.transfer_transaction_id.is_(None),  # Not already paired
        )
        .first()
    )

    if match:
        return TransferMatch(
            account_id=match.account_id,
            account_name=match.account.name if match.account else "Unknown Account",
            transaction_id=match.id,
        )

    # If no exact transaction found, check if there is an active account that could be a target
    # e.g., if checking account payment says "AUTOPAY CHASE CREDIT CARD", detect Chase account
    return None
