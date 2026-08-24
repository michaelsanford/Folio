import io
from app.services.ingestion.ofx_parser import parse_ofx_content


def test_ofx_parser_with_sample_banking_ofx(db_session, sample_checking_account):
    sample_ofx = b"""OFXHEADER:100
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
<CURDEF>USD
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
<TRNAMT>-42.50
<FITID>FIT2026080501
<NAME>SAFEWAY STORE #451
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260810120000
<TRNAMT>2500.00
<FITID>FIT2026081001
<NAME>EMPLOYER PAYROLL
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
    result = parse_ofx_content(
        db=db_session,
        account_id=sample_checking_account.id,
        content=sample_ofx,
        filename="checking_statement.ofx",
    )
    assert result.file_type == "OFX"
    assert len(result.items) == 2
    assert result.items[0].raw_payee == "SAFEWAY STORE #451"
    assert result.items[0].amount == -42.50
    assert result.items[1].raw_payee == "EMPLOYER PAYROLL"
    assert result.items[1].amount == 2500.00
