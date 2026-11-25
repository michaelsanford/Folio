"""Baseline schema.

Revision ID: 0001
Revises: (none)

The whole schema as of November 2026, replacing the eleven incremental
revisions that built it up. The DDL is exactly what those revisions produced
on SQLite (tables, foreign keys, CHECK constraints and indexes, including the
partial unique index on transactions(account_id, import_hash)), so a vault
created here is identical to one migrated step by step.

New schema changes go in new revisions on top of this one.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]

# In creation order. SQLite accepts a foreign key to a table created later.
SCHEMA = (
    "CREATE TABLE budgets (\n\tid VARCHAR(36) NOT NULL, \n\tyear INTEGER NOT NULL, \n\tmonth INTEGER NOT NULL, \n\ttotal_income_target_cents INTEGER NOT NULL, \n\ttotal_expense_target_cents INTEGER NOT NULL, \n\tnotes VARCHAR(500), \n\tcreated_at DATETIME NOT NULL, \n\tupdated_at DATETIME NOT NULL, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tCONSTRAINT uq_budget_year_month UNIQUE (year, month)\n)",
    "CREATE TABLE securities (\n\tid VARCHAR(36) NOT NULL, \n\tsymbol VARCHAR(32) NOT NULL, \n\tname VARCHAR(200), \n\texchange VARCHAR(32), \n\tcurrency VARCHAR(3) NOT NULL, \n\tasset_class VARCHAR(12) NOT NULL, \n\tcreated_at DATETIME NOT NULL, quote_symbol VARCHAR(32), exchange_timezone VARCHAR(64), \n\tPRIMARY KEY (id)\n)",
    "CREATE UNIQUE INDEX ix_securities_symbol ON securities (symbol)",
    "CREATE TABLE account_balance_snapshots (\n\tid VARCHAR(36) NOT NULL, \n\taccount_id VARCHAR(36) NOT NULL, \n\tas_of_date DATE NOT NULL, \n\tbalance_cents INTEGER NOT NULL, \n\tcreated_at DATETIME NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE CASCADE, \n\tCONSTRAINT uq_snapshot_account_date UNIQUE (account_id, as_of_date)\n)",
    "CREATE INDEX ix_account_balance_snapshots_as_of_date ON account_balance_snapshots (as_of_date)",
    "CREATE INDEX ix_snapshots_date_account ON account_balance_snapshots (as_of_date, account_id)",
    "CREATE TABLE budget_items (\n\tid VARCHAR(36) NOT NULL, \n\tbudget_id VARCHAR(36) NOT NULL, \n\tcategory_id VARCHAR(36) NOT NULL, \n\tplanned_amount_cents INTEGER NOT NULL, rollover_amount_cents INTEGER DEFAULT '0' NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(budget_id) REFERENCES budgets (id) ON DELETE CASCADE, \n\tFOREIGN KEY(category_id) REFERENCES categories (id) ON DELETE CASCADE, \n\tCONSTRAINT uq_budget_item_budget_category UNIQUE (budget_id, category_id)\n)",
    "CREATE INDEX ix_budget_items_budget_id ON budget_items (budget_id)",
    "CREATE INDEX ix_budget_items_category_id ON budget_items (category_id)",
    "CREATE TABLE categorization_rules (\n\tid VARCHAR(36) NOT NULL, \n\tcategory_id VARCHAR(36) NOT NULL, \n\tpriority INTEGER NOT NULL, \n\tpattern_type VARCHAR(11) NOT NULL, \n\tpattern VARCHAR(255) NOT NULL, \n\tmin_amount_cents INTEGER, \n\tmax_amount_cents INTEGER, \n\ttarget_account_id VARCHAR(36), \n\tnormalized_payee_override VARCHAR(255), \n\tis_active BOOLEAN NOT NULL, \n\tcreated_at DATETIME NOT NULL, \n\tupdated_at DATETIME NOT NULL, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(category_id) REFERENCES categories (id) ON DELETE CASCADE\n)",
    "CREATE INDEX ix_categorization_rules_category_id ON categorization_rules (category_id)",
    "CREATE TABLE holdings (\n\tid VARCHAR(36) NOT NULL, \n\taccount_id VARCHAR(36) NOT NULL, \n\tsecurity_id VARCHAR(36) NOT NULL, \n\tcreated_at DATETIME NOT NULL, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE CASCADE, \n\tFOREIGN KEY(security_id) REFERENCES securities (id) ON DELETE CASCADE, \n\tCONSTRAINT uq_holding_account_security UNIQUE (account_id, security_id)\n)",
    "CREATE INDEX ix_holdings_account_id ON holdings (account_id)",
    "CREATE INDEX ix_holdings_security_id ON holdings (security_id)",
    "CREATE TABLE investment_activities (\n\tid VARCHAR(36) NOT NULL, \n\taccount_id VARCHAR(36) NOT NULL, \n\tsecurity_id VARCHAR(36), \n\ttype VARCHAR(12) NOT NULL, \n\ttrade_date DATE NOT NULL, \n\tquantity NUMERIC(28, 8), \n\tamount_cents INTEGER NOT NULL, \n\tfee_cents INTEGER NOT NULL, \n\tnotes VARCHAR(500), \n\tcreated_at DATETIME NOT NULL, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE CASCADE, \n\tFOREIGN KEY(security_id) REFERENCES securities (id) ON DELETE SET NULL\n)",
    "CREATE INDEX ix_activity_account_date ON investment_activities (account_id, trade_date)",
    "CREATE INDEX ix_investment_activities_account_id ON investment_activities (account_id)",
    "CREATE INDEX ix_investment_activities_security_id ON investment_activities (security_id)",
    "CREATE INDEX ix_investment_activities_trade_date ON investment_activities (trade_date)",
    "CREATE TABLE price_quotes (\n\tid VARCHAR(36) NOT NULL, \n\tsecurity_id VARCHAR(36) NOT NULL, \n\tas_of_date DATE NOT NULL, \n\tprice_cents INTEGER NOT NULL, \n\tcreated_at DATETIME NOT NULL, source VARCHAR(16) DEFAULT 'MANUAL' NOT NULL, quoted_at DATETIME, fetched_at DATETIME, session VARCHAR(8), previous_close_cents INTEGER, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(security_id) REFERENCES securities (id) ON DELETE CASCADE, \n\tCONSTRAINT uq_quote_security_date UNIQUE (security_id, as_of_date)\n)",
    "CREATE INDEX ix_price_quotes_as_of_date ON price_quotes (as_of_date)",
    "CREATE INDEX ix_price_quotes_security_id ON price_quotes (security_id)",
    "CREATE INDEX ix_quotes_security_date ON price_quotes (security_id, as_of_date)",
    "CREATE TABLE lots (\n\tid VARCHAR(36) NOT NULL, \n\tholding_id VARCHAR(36) NOT NULL, \n\ttrade_date DATE NOT NULL, \n\tquantity NUMERIC(28, 8) NOT NULL, \n\tcost_basis_cents INTEGER NOT NULL, \n\tfee_cents INTEGER NOT NULL, \n\tclosed_quantity NUMERIC(28, 8) NOT NULL, \n\tcreated_at DATETIME NOT NULL, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(holding_id) REFERENCES holdings (id) ON DELETE CASCADE\n)",
    "CREATE INDEX ix_lots_holding_id ON lots (holding_id)",
    "CREATE INDEX ix_lots_trade_date ON lots (trade_date)",
    "CREATE TABLE transaction_splits (\n\tid VARCHAR(36) NOT NULL, \n\ttransaction_id VARCHAR(36) NOT NULL, \n\tcategory_id VARCHAR(36), \n\tamount_cents INTEGER NOT NULL, \n\tmemo VARCHAR(255), \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(category_id) REFERENCES categories (id) ON DELETE SET NULL, \n\tFOREIGN KEY(transaction_id) REFERENCES transactions (id) ON DELETE CASCADE\n)",
    "CREATE INDEX ix_splits_transaction_category ON transaction_splits (transaction_id, category_id)",
    "CREATE INDEX ix_transaction_splits_category_id ON transaction_splits (category_id)",
    "CREATE TABLE household_members (\n\tid VARCHAR(36) NOT NULL, \n\tname VARCHAR(100) NOT NULL, \n\tcolor VARCHAR(20) DEFAULT '#10B981' NOT NULL, \n\tavatar_icon VARCHAR(50) DEFAULT 'user' NOT NULL, \n\trole VARCHAR(50) DEFAULT 'Member', \n\tnotes VARCHAR(255), \n\tcreated_at DATETIME NOT NULL, \n\tupdated_at DATETIME NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE TABLE \"accounts\" (\n\tid VARCHAR(36) NOT NULL, \n\tname VARCHAR(100) NOT NULL, \n\ttype VARCHAR(15) NOT NULL, \n\tinstitution VARCHAR(100), \n\taccount_number_mask VARCHAR(20), \n\tcurrency VARCHAR(3) NOT NULL, \n\tcurrent_balance_cents INTEGER NOT NULL, \n\tcredit_limit_cents INTEGER, \n\tinterest_rate FLOAT, \n\tloan_origination_date DATETIME, \n\tloan_term_months INTEGER, \n\tloan_original_principal_cents INTEGER, \n\tmonthly_payment_cents INTEGER, \n\tescrow_payment_cents INTEGER, \n\tcompounding VARCHAR(11) NOT NULL, \n\tis_active BOOLEAN NOT NULL, \n\tcreated_at DATETIME NOT NULL, \n\tupdated_at DATETIME NOT NULL, \n\ticon VARCHAR(50), \n\tcolor VARCHAR(20), \n\towner_member_id VARCHAR(36), minimum_payment_percent FLOAT, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tCONSTRAINT fk_accounts_owner_member_id FOREIGN KEY(owner_member_id) REFERENCES household_members (id) ON DELETE SET NULL\n)",
    "CREATE TABLE \"transactions\" (\n\tid VARCHAR(36) NOT NULL, \n\taccount_id VARCHAR(36) NOT NULL, \n\ttransfer_transaction_id VARCHAR(36), \n\tstatement_file_id VARCHAR(36), \n\ttransaction_date DATETIME NOT NULL, \n\tposted_date DATETIME, \n\traw_payee VARCHAR(255) NOT NULL, \n\tnormalized_payee VARCHAR(255), \n\tamount_cents INTEGER NOT NULL, \n\tcurrency VARCHAR(3) NOT NULL, \n\timport_hash VARCHAR(64), \n\tstatus VARCHAR(10) NOT NULL, \n\tnotes VARCHAR(500), \n\tcreated_at DATETIME NOT NULL, \n\tupdated_at DATETIME NOT NULL, \n\tassigned_member_id VARCHAR(36), created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tCONSTRAINT fk_transactions_assigned_member_id FOREIGN KEY(assigned_member_id) REFERENCES household_members (id) ON DELETE SET NULL, \n\tFOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE CASCADE, \n\tFOREIGN KEY(transfer_transaction_id) REFERENCES transactions (id) ON DELETE SET NULL, \n\tFOREIGN KEY(statement_file_id) REFERENCES statement_files (id) ON DELETE SET NULL\n)",
    "CREATE INDEX ix_transactions_normalized_payee ON transactions (normalized_payee)",
    "CREATE INDEX ix_transactions_account_import_hash ON transactions (account_id, import_hash)",
    "CREATE INDEX ix_transactions_account_date ON transactions (account_id, transaction_date)",
    "CREATE INDEX ix_transactions_transaction_date ON transactions (transaction_date)",
    "CREATE TABLE \"categories\" (\n\tid VARCHAR(36) NOT NULL, \n\tparent_id VARCHAR(36), \n\tname VARCHAR(100) NOT NULL, \n\tslug VARCHAR(100) NOT NULL, \n\ticon VARCHAR(50), \n\tcolor VARCHAR(20), \n\ttype VARCHAR(8) NOT NULL, \n\tis_budgeted BOOLEAN NOT NULL, \n\tsort_order INTEGER NOT NULL, \n\tcreated_at DATETIME NOT NULL, \n\tupdated_at DATETIME NOT NULL, \n\tis_rollover BOOLEAN DEFAULT 0 NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (slug), \n\tFOREIGN KEY(parent_id) REFERENCES categories (id) ON DELETE SET NULL\n)",
    "CREATE TABLE goals (\n\tid VARCHAR(36) NOT NULL, \n\tname VARCHAR(100) NOT NULL, \n\ttype VARCHAR(14) DEFAULT 'SAVINGS' NOT NULL, \n\ttarget_amount_cents INTEGER DEFAULT '0' NOT NULL, \n\tcurrent_amount_cents INTEGER, \n\ttarget_date DATE, \n\temergency_fund_months INTEGER DEFAULT '6', \n\texcluded_category_ids TEXT, \n\tlinked_account_id VARCHAR(36), \n\towner_member_id VARCHAR(36), \n\tnotes VARCHAR(500), \n\tcreated_at DATETIME NOT NULL, \n\tupdated_at DATETIME NOT NULL, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(linked_account_id) REFERENCES accounts (id) ON DELETE SET NULL, \n\tFOREIGN KEY(owner_member_id) REFERENCES household_members (id) ON DELETE SET NULL\n)",
    "CREATE TABLE \"statement_files\" (\n\tid VARCHAR(36) NOT NULL, \n\taccount_id VARCHAR(36), \n\tfilename VARCHAR(255) NOT NULL, \n\tfile_path VARCHAR(500) NOT NULL, \n\tfile_hash VARCHAR(64) NOT NULL, \n\tmime_type VARCHAR(100) NOT NULL, \n\tfile_size INTEGER NOT NULL, \n\ttransaction_count INTEGER NOT NULL, \n\tuploaded_at DATETIME NOT NULL, created_by VARCHAR(128), updated_by VARCHAR(128), \n\tPRIMARY KEY (id), \n\tCONSTRAINT fk_statement_files_account_id_accounts FOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE SET NULL\n)",
    "CREATE INDEX ix_transactions_transfer_transaction_id ON transactions (transfer_transaction_id)",
    "CREATE INDEX ix_transactions_statement_file_id ON transactions (statement_file_id)",
    "CREATE INDEX ix_transactions_amount_date ON transactions (amount_cents, transaction_date)",
    "CREATE INDEX ix_categorization_rules_pattern ON categorization_rules (pattern)",
    "CREATE UNIQUE INDEX uq_transactions_account_import_hash ON transactions (account_id, import_hash) WHERE import_hash IS NOT NULL",
    "CREATE TABLE user_preferences (\n\tuser_key VARCHAR(128) NOT NULL, \n\tdata TEXT NOT NULL, \n\tupdated_at DATETIME NOT NULL, \n\tPRIMARY KEY (user_key)\n)",
    "CREATE TABLE app_users (\n\tuser_key VARCHAR(128) NOT NULL, \n\temail VARCHAR(254), \n\tdisplay_name VARCHAR(100), \n\trole VARCHAR(16) DEFAULT 'MEMBER' NOT NULL, \n\tstatus VARCHAR(16) DEFAULT 'ACTIVE' NOT NULL, \n\tmember_id VARCHAR(36), \n\tinvited_by VARCHAR(128), \n\tcreated_at DATETIME NOT NULL, \n\tlast_sign_in_at DATETIME, \n\tPRIMARY KEY (user_key), \n\tCONSTRAINT uq_app_users_member_id UNIQUE (member_id), \n\tFOREIGN KEY(member_id) REFERENCES household_members (id) ON DELETE SET NULL\n)",
    "CREATE INDEX ix_app_users_email ON app_users (email)",
    "CREATE TABLE period_closures (\n\tyear INTEGER NOT NULL, \n\tclosed_through DATE NOT NULL, \n\tclosed_by VARCHAR(128), \n\tclosed_at DATETIME NOT NULL, \n\tarchive_key VARCHAR(255), \n\tarchive_sha256 VARCHAR(64), \n\tarchive_bytes INTEGER, \n\trow_counts JSON, \n\treopened_at DATETIME, \n\treopened_by VARCHAR(128), \n\tPRIMARY KEY (year)\n)",
)

TABLES = (
    "period_closures",
    "app_users",
    "user_preferences",
    "statement_files",
    "goals",
    "categories",
    "transactions",
    "accounts",
    "household_members",
    "transaction_splits",
    "lots",
    "price_quotes",
    "investment_activities",
    "holdings",
    "categorization_rules",
    "budget_items",
    "account_balance_snapshots",
    "securities",
    "budgets",
)


def upgrade() -> None:
    for statement in SCHEMA:
        op.execute(statement)


def downgrade() -> None:
    for table in TABLES:
        op.drop_table(table)
