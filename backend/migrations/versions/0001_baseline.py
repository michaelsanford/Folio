"""Baseline schema.

Revision ID: 0001
Revises: (none)

The whole schema, created from the models on Postgres. The same revision runs
on the serverless database, where the dialect commits after every statement
and builds indexes asynchronously.

New schema changes go in new revisions on top of this one.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('budgets',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('total_income_target_cents', sa.Integer(), nullable=False),
    sa.Column('total_expense_target_cents', sa.Integer(), nullable=False),
    sa.Column('notes', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('year', 'month', name='uq_budget_year_month')
    )
    op.create_table('categories',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('parent_id', sa.String(length=36), nullable=True),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('slug', sa.String(length=100), nullable=False),
    sa.Column('icon', sa.String(length=50), nullable=True),
    sa.Column('color', sa.String(length=20), nullable=True),
    sa.Column('type', sa.Enum('INCOME', 'EXPENSE', 'TRANSFER', name='categorytype', native_enum=False), nullable=False),
    sa.Column('is_budgeted', sa.Boolean(), nullable=False),
    sa.Column('is_rollover', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['parent_id'], ['categories.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    op.create_table('household_members',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('color', sa.String(length=20), nullable=False),
    sa.Column('avatar_icon', sa.String(length=50), nullable=False),
    sa.Column('role', sa.String(length=50), nullable=True),
    sa.Column('notes', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('period_closures',
    sa.Column('year', sa.Integer(), autoincrement=False, nullable=False),
    sa.Column('closed_through', sa.Date(), nullable=False),
    sa.Column('closed_by', sa.String(length=128), nullable=True),
    sa.Column('closed_at', sa.DateTime(), nullable=False),
    sa.Column('archive_key', sa.String(length=255), nullable=True),
    sa.Column('archive_sha256', sa.String(length=64), nullable=True),
    sa.Column('archive_bytes', sa.Integer(), nullable=True),
    sa.Column('row_counts', sa.JSON(), nullable=True),
    sa.Column('reopened_at', sa.DateTime(), nullable=True),
    sa.Column('reopened_by', sa.String(length=128), nullable=True),
    sa.PrimaryKeyConstraint('year')
    )
    op.create_table('securities',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('symbol', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=True),
    sa.Column('exchange', sa.String(length=32), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('asset_class', sa.Enum('EQUITY', 'ETF', 'MUTUAL_FUND', 'FIXED_INCOME', 'CASH', 'CRYPTO', 'OTHER', name='assetclass', native_enum=False), nullable=False),
    sa.Column('quote_symbol', sa.String(length=32), nullable=True),
    sa.Column('exchange_timezone', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_securities_symbol'), 'securities', ['symbol'], unique=True)
    op.create_table('user_preferences',
    sa.Column('user_key', sa.String(length=128), nullable=False),
    sa.Column('data', sa.Text(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_key')
    )
    op.create_table('accounts',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('type', sa.Enum('CHECKING', 'SAVINGS', 'HISA', 'CASH', 'TFSA', 'RRSP', 'FHSA', 'RESP', 'RDSP', 'RRIF', 'LIRA', 'LIF', 'IPP', 'INVESTMENT', 'NON_REGISTERED', 'CRYPTO', 'CREDIT_CARD', 'LINE_OF_CREDIT', 'MORTGAGE', 'VEHICLE_LOAN', 'STUDENT_LOAN', 'PERSONAL_LOAN', 'OTHER_LIABILITY', 'REAL_ESTATE', 'VEHICLE_ASSET', 'OTHER_ASSET', name='accounttype', native_enum=False), nullable=False),
    sa.Column('institution', sa.String(length=100), nullable=True),
    sa.Column('account_number_mask', sa.String(length=20), nullable=True),
    sa.Column('icon', sa.String(length=50), nullable=True),
    sa.Column('color', sa.String(length=20), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('current_balance_cents', sa.Integer(), nullable=False),
    sa.Column('credit_limit_cents', sa.Integer(), nullable=True),
    sa.Column('interest_rate', sa.Float(), nullable=True),
    sa.Column('loan_origination_date', sa.DateTime(), nullable=True),
    sa.Column('loan_term_months', sa.Integer(), nullable=True),
    sa.Column('loan_original_principal_cents', sa.Integer(), nullable=True),
    sa.Column('monthly_payment_cents', sa.Integer(), nullable=True),
    sa.Column('escrow_payment_cents', sa.Integer(), nullable=True),
    sa.Column('minimum_payment_percent', sa.Float(), nullable=True),
    sa.Column('compounding', sa.Enum('MONTHLY', 'SEMI_ANNUAL', name='loancompounding', native_enum=False), nullable=False),
    sa.Column('owner_member_id', sa.String(length=36), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['owner_member_id'], ['household_members.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('app_users',
    sa.Column('user_key', sa.String(length=128), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=True),
    sa.Column('display_name', sa.String(length=100), nullable=True),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('member_id', sa.String(length=36), nullable=True),
    sa.Column('invited_by', sa.String(length=128), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_sign_in_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['member_id'], ['household_members.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('user_key'),
    sa.UniqueConstraint('member_id')
    )
    op.create_index(op.f('ix_app_users_email'), 'app_users', ['email'], unique=False)
    op.create_table('budget_items',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('budget_id', sa.String(length=36), nullable=False),
    sa.Column('category_id', sa.String(length=36), nullable=False),
    sa.Column('planned_amount_cents', sa.Integer(), nullable=False),
    sa.Column('rollover_amount_cents', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['budget_id'], ['budgets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('budget_id', 'category_id', name='uq_budget_item_budget_category')
    )
    op.create_index(op.f('ix_budget_items_budget_id'), 'budget_items', ['budget_id'], unique=False)
    op.create_index(op.f('ix_budget_items_category_id'), 'budget_items', ['category_id'], unique=False)
    op.create_table('categorization_rules',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('category_id', sa.String(length=36), nullable=False),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('pattern_type', sa.Enum('EXACT', 'CONTAINS', 'REGEX', 'STARTS_WITH', name='rulepatterntype', native_enum=False), nullable=False),
    sa.Column('pattern', sa.String(length=255), nullable=False),
    sa.Column('min_amount_cents', sa.Integer(), nullable=True),
    sa.Column('max_amount_cents', sa.Integer(), nullable=True),
    sa.Column('target_account_id', sa.String(length=36), nullable=True),
    sa.Column('normalized_payee_override', sa.String(length=255), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_categorization_rules_category_id'), 'categorization_rules', ['category_id'], unique=False)
    op.create_index(op.f('ix_categorization_rules_pattern'), 'categorization_rules', ['pattern'], unique=False)
    op.create_table('price_quotes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('security_id', sa.String(length=36), nullable=False),
    sa.Column('as_of_date', sa.Date(), nullable=False),
    sa.Column('price_cents', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=16), server_default='MANUAL', nullable=False),
    sa.Column('quoted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('session', sa.String(length=8), nullable=True),
    sa.Column('previous_close_cents', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['security_id'], ['securities.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('security_id', 'as_of_date', name='uq_quote_security_date')
    )
    op.create_index(op.f('ix_price_quotes_as_of_date'), 'price_quotes', ['as_of_date'], unique=False)
    op.create_index(op.f('ix_price_quotes_security_id'), 'price_quotes', ['security_id'], unique=False)
    op.create_index('ix_quotes_security_date', 'price_quotes', ['security_id', 'as_of_date'], unique=False)
    op.create_table('account_balance_snapshots',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('as_of_date', sa.Date(), nullable=False),
    sa.Column('balance_cents', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id', 'as_of_date', name='uq_snapshot_account_date')
    )
    op.create_index(op.f('ix_account_balance_snapshots_as_of_date'), 'account_balance_snapshots', ['as_of_date'], unique=False)
    op.create_index('ix_snapshots_date_account', 'account_balance_snapshots', ['as_of_date', 'account_id'], unique=False)
    op.create_table('goals',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('type', sa.Enum('SAVINGS', 'EMERGENCY_FUND', 'TFSA_ANNUAL', 'FHSA_ANNUAL', 'HBP_REPAYMENT', 'DEBT_PAYOFF', name='goaltype', native_enum=False), nullable=False),
    sa.Column('target_amount_cents', sa.Integer(), nullable=False),
    sa.Column('current_amount_cents', sa.Integer(), nullable=True),
    sa.Column('target_date', sa.Date(), nullable=True),
    sa.Column('emergency_fund_months', sa.Integer(), nullable=True),
    sa.Column('excluded_category_ids', sa.Text(), nullable=True),
    sa.Column('linked_account_id', sa.String(length=36), nullable=True),
    sa.Column('owner_member_id', sa.String(length=36), nullable=True),
    sa.Column('notes', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['linked_account_id'], ['accounts.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_member_id'], ['household_members.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('holdings',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('security_id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['security_id'], ['securities.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id', 'security_id', name='uq_holding_account_security')
    )
    op.create_index(op.f('ix_holdings_account_id'), 'holdings', ['account_id'], unique=False)
    op.create_index(op.f('ix_holdings_security_id'), 'holdings', ['security_id'], unique=False)
    op.create_table('investment_activities',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('security_id', sa.String(length=36), nullable=True),
    sa.Column('type', sa.Enum('BUY', 'SELL', 'DIVIDEND', 'CONTRIBUTION', 'WITHDRAWAL', 'FEE', name='investmentactivitytype', native_enum=False), nullable=False),
    sa.Column('trade_date', sa.Date(), nullable=False),
    sa.Column('quantity', sa.Numeric(precision=28, scale=8), nullable=True),
    sa.Column('amount_cents', sa.Integer(), nullable=False),
    sa.Column('fee_cents', sa.Integer(), nullable=False),
    sa.Column('notes', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['security_id'], ['securities.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_activity_account_date', 'investment_activities', ['account_id', 'trade_date'], unique=False)
    op.create_index(op.f('ix_investment_activities_account_id'), 'investment_activities', ['account_id'], unique=False)
    op.create_index(op.f('ix_investment_activities_security_id'), 'investment_activities', ['security_id'], unique=False)
    op.create_index(op.f('ix_investment_activities_trade_date'), 'investment_activities', ['trade_date'], unique=False)
    op.create_table('statement_files',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=True),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('file_path', sa.String(length=500), nullable=False),
    sa.Column('file_hash', sa.String(length=64), nullable=False),
    sa.Column('mime_type', sa.String(length=100), nullable=False),
    sa.Column('file_size', sa.Integer(), nullable=False),
    sa.Column('transaction_count', sa.Integer(), nullable=False),
    sa.Column('uploaded_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('lots',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('holding_id', sa.String(length=36), nullable=False),
    sa.Column('trade_date', sa.Date(), nullable=False),
    sa.Column('quantity', sa.Numeric(precision=28, scale=8), nullable=False),
    sa.Column('cost_basis_cents', sa.Integer(), nullable=False),
    sa.Column('fee_cents', sa.Integer(), nullable=False),
    sa.Column('closed_quantity', sa.Numeric(precision=28, scale=8), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['holding_id'], ['holdings.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_lots_holding_id'), 'lots', ['holding_id'], unique=False)
    op.create_index(op.f('ix_lots_trade_date'), 'lots', ['trade_date'], unique=False)
    op.create_table('transactions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('transfer_transaction_id', sa.String(length=36), nullable=True),
    sa.Column('statement_file_id', sa.String(length=36), nullable=True),
    sa.Column('assigned_member_id', sa.String(length=36), nullable=True),
    sa.Column('transaction_date', sa.DateTime(), nullable=False),
    sa.Column('posted_date', sa.DateTime(), nullable=True),
    sa.Column('raw_payee', sa.String(length=255), nullable=False),
    sa.Column('normalized_payee', sa.String(length=255), nullable=True),
    sa.Column('amount_cents', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('import_hash', sa.String(length=64), nullable=True),
    sa.Column('status', sa.Enum('PENDING', 'CLEARED', 'RECONCILED', name='transactionstatus', native_enum=False), nullable=False),
    sa.Column('notes', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.String(length=128), nullable=True),
    sa.Column('updated_by', sa.String(length=128), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['assigned_member_id'], ['household_members.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['statement_file_id'], ['statement_files.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['transfer_transaction_id'], ['transactions.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_transactions_account_date', 'transactions', ['account_id', 'transaction_date'], unique=False)
    op.create_index('ix_transactions_account_import_hash', 'transactions', ['account_id', 'import_hash'], unique=False)
    op.create_index('ix_transactions_amount_date', 'transactions', ['amount_cents', 'transaction_date'], unique=False)
    op.create_index(op.f('ix_transactions_normalized_payee'), 'transactions', ['normalized_payee'], unique=False)
    op.create_index(op.f('ix_transactions_statement_file_id'), 'transactions', ['statement_file_id'], unique=False)
    op.create_index(op.f('ix_transactions_transaction_date'), 'transactions', ['transaction_date'], unique=False)
    op.create_index(op.f('ix_transactions_transfer_transaction_id'), 'transactions', ['transfer_transaction_id'], unique=False)
    op.create_index('uq_transactions_account_import_hash', 'transactions', ['account_id', 'import_hash'], unique=True)
    op.create_table('transaction_splits',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('transaction_id', sa.String(length=36), nullable=False),
    sa.Column('category_id', sa.String(length=36), nullable=True),
    sa.Column('amount_cents', sa.Integer(), nullable=False),
    sa.Column('memo', sa.String(length=255), nullable=True),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_splits_transaction_category', 'transaction_splits', ['transaction_id', 'category_id'], unique=False)
    op.create_index(op.f('ix_transaction_splits_category_id'), 'transaction_splits', ['category_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_transaction_splits_category_id'), table_name='transaction_splits')
    op.drop_index('ix_splits_transaction_category', table_name='transaction_splits')
    op.drop_table('transaction_splits')
    op.drop_index('uq_transactions_account_import_hash', table_name='transactions')
    op.drop_index(op.f('ix_transactions_transfer_transaction_id'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_transaction_date'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_statement_file_id'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_normalized_payee'), table_name='transactions')
    op.drop_index('ix_transactions_amount_date', table_name='transactions')
    op.drop_index('ix_transactions_account_import_hash', table_name='transactions')
    op.drop_index('ix_transactions_account_date', table_name='transactions')
    op.drop_table('transactions')
    op.drop_index(op.f('ix_lots_trade_date'), table_name='lots')
    op.drop_index(op.f('ix_lots_holding_id'), table_name='lots')
    op.drop_table('lots')
    op.drop_table('statement_files')
    op.drop_index(op.f('ix_investment_activities_trade_date'), table_name='investment_activities')
    op.drop_index(op.f('ix_investment_activities_security_id'), table_name='investment_activities')
    op.drop_index(op.f('ix_investment_activities_account_id'), table_name='investment_activities')
    op.drop_index('ix_activity_account_date', table_name='investment_activities')
    op.drop_table('investment_activities')
    op.drop_index(op.f('ix_holdings_security_id'), table_name='holdings')
    op.drop_index(op.f('ix_holdings_account_id'), table_name='holdings')
    op.drop_table('holdings')
    op.drop_table('goals')
    op.drop_index('ix_snapshots_date_account', table_name='account_balance_snapshots')
    op.drop_index(op.f('ix_account_balance_snapshots_as_of_date'), table_name='account_balance_snapshots')
    op.drop_table('account_balance_snapshots')
    op.drop_index('ix_quotes_security_date', table_name='price_quotes')
    op.drop_index(op.f('ix_price_quotes_security_id'), table_name='price_quotes')
    op.drop_index(op.f('ix_price_quotes_as_of_date'), table_name='price_quotes')
    op.drop_table('price_quotes')
    op.drop_index(op.f('ix_categorization_rules_pattern'), table_name='categorization_rules')
    op.drop_index(op.f('ix_categorization_rules_category_id'), table_name='categorization_rules')
    op.drop_table('categorization_rules')
    op.drop_index(op.f('ix_budget_items_category_id'), table_name='budget_items')
    op.drop_index(op.f('ix_budget_items_budget_id'), table_name='budget_items')
    op.drop_table('budget_items')
    op.drop_index(op.f('ix_app_users_email'), table_name='app_users')
    op.drop_table('app_users')
    op.drop_table('accounts')
    op.drop_table('user_preferences')
    op.drop_index(op.f('ix_securities_symbol'), table_name='securities')
    op.drop_table('securities')
    op.drop_table('period_closures')
    op.drop_table('household_members')
    op.drop_table('categories')
    op.drop_table('budgets')
