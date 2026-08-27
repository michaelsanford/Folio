"""Folio targets Canadian households, so CAD is the default currency.

The merchant rules, bank parsers, and mortgage compounding all assume CAD; a
foreign-currency row is the exception. These tests pin the default so it cannot
drift back, and pin the cases where the statement itself is authoritative and
must win over the default.
"""
import io
from datetime import datetime

from ofxtools import OFXTree

from app.api.categories import seed_default_categories
from app.api.rules import seed_default_rules
from app.core.config import settings
from app.models.account import Account, AccountType
from app.models.transaction import Transaction
from app.services.ingestion.csv_parser import parse_csv_content
from app.services.ingestion.ofx_parser import parse_ofx_content


# --- The default -------------------------------------------------------------

def test_default_currency_setting_is_cad():
    assert settings.DEFAULT_CURRENCY == "CAD"


def test_account_created_without_a_currency_defaults_to_cad(db_session):
    account = Account(name="Chequing", type=AccountType.CHECKING)
    db_session.add(account)
    db_session.commit()
    assert account.currency == "CAD"


def test_transaction_created_without_a_currency_defaults_to_cad(
    db_session, sample_checking_account
):
    txn = Transaction(
        account_id=sample_checking_account.id,
        transaction_date=datetime(2026, 8, 27),
        raw_payee="BOUSTAN",
        amount=-19.47,
    )
    db_session.add(txn)
    db_session.commit()
    assert txn.currency == "CAD"


def test_api_created_account_defaults_to_cad(client):
    created = client.post("/api/accounts", json={
        "name": "Fresh Chequing",
        "type": "CHECKING",
    })
    assert created.status_code == 201
    assert created.json()["currency"] == "CAD"


def test_api_created_transaction_defaults_to_cad(client, sample_checking_account):
    created = client.post("/api/transactions", json={
        "account_id": sample_checking_account.id,
        "transaction_date": "2026-08-27T00:00:00",
        "raw_payee": "BOUSTAN",
        "amount": -19.47,
    })
    assert created.status_code == 201
    assert created.json()["currency"] == "CAD"


# --- CSV: the column a row's amount came from is that row's currency ---------

def test_rbc_csv_takes_each_row_currency_from_its_column(
    db_session, sample_checking_account
):
    """RBC statements carry both CAD$ and USD$ columns."""
    seed_default_categories(db_session)
    seed_default_rules(db_session)

    csv_data = (
        "Account Type,Account Number,Transaction Date,Cheque Number,"
        "Description 1,Description 2,CAD$,USD$\n"
        "Visa,4514xxxx,6/27/2026,,BOUSTAN GREENFIELD PARK,,-19.47,\n"
        "Visa,4514xxxx,6/28/2026,,JEAN COUTU #142,,,-25.50\n"
    )
    result = parse_csv_content(
        db_session, sample_checking_account.id, csv_data, "rbc_statement.csv"
    )

    assert [i.currency for i in result.items] == ["CAD", "USD"]


def test_plain_csv_without_currency_columns_defaults_to_cad(
    db_session, sample_checking_account
):
    csv_data = "Date,Description,Amount\n2026-08-01,Tim Hortons,-2.45\n"
    result = parse_csv_content(
        db_session, sample_checking_account.id, csv_data, "simple.csv"
    )
    assert result.items[0].currency == "CAD"


# --- OFX: the file declares its own currency in CURDEF -----------------------

VALID_OFX = """OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20260820120000
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1001
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>{curdef}
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>123456
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801120000
<DTEND>20260820120000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260805120000
<TRNAMT>-19.47
<FITID>FITCUR001
<NAME>BOUSTAN
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>5457.50
<DTASOF>20260820120000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
"""

# Malformed header, so ofxtools rejects it and the regex fallback path runs.
SGML_ONLY_OFX = """OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
{curdef_line}<BANKACCTFROM><BANKID>001</BANKID><ACCTID>123</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260827<TRNAMT>-19.47<FITID>ofx-cur-1<NAME>BOUSTAN</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
"""


def _sgml_ofx(curdef: str | None) -> str:
    return SGML_ONLY_OFX.format(
        curdef_line=f"<CURDEF>{curdef}\n" if curdef else ""
    )


def test_structured_path_is_what_the_valid_fixture_exercises():
    """Guard: if this fixture stopped parsing natively, the test below would
    silently be re-testing the regex fallback instead."""
    tree = OFXTree()
    tree.parse(io.BytesIO(VALID_OFX.format(curdef="CAD").encode()))
    statements = tree.convert().statements
    assert statements and statements[0].curdef == "CAD"


def test_structured_ofx_reads_curdef_natively(db_session, sample_checking_account):
    raw = VALID_OFX.format(curdef="CAD")
    result = parse_ofx_content(db_session, sample_checking_account.id, raw, "cad.ofx")
    assert result.items
    assert all(i.currency == "CAD" for i in result.items)


def test_structured_ofx_keeps_a_usd_statement_in_usd(
    db_session, sample_checking_account
):
    """A genuine USD statement must not be relabelled CAD by the default."""
    raw = VALID_OFX.format(curdef="USD")
    result = parse_ofx_content(db_session, sample_checking_account.id, raw, "usd.ofx")
    assert result.items
    assert all(i.currency == "USD" for i in result.items)


def test_fallback_ofx_reads_curdef_from_sgml(db_session, sample_checking_account):
    result = parse_ofx_content(
        db_session, sample_checking_account.id, _sgml_ofx("USD"), "usd.ofx"
    )
    assert result.items, "expected the fallback parser to produce items"
    assert all(i.currency == "USD" for i in result.items)


def test_fallback_ofx_without_curdef_uses_the_default(
    db_session, sample_checking_account
):
    result = parse_ofx_content(
        db_session, sample_checking_account.id, _sgml_ofx(None), "nocurdef.ofx"
    )
    assert result.items
    assert all(i.currency == "CAD" for i in result.items)
