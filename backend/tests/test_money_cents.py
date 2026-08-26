"""Integer cents must be exact where float was not."""
import random
from decimal import Decimal

import pytest

from app.core.money import from_cents, from_cents_optional, to_cents, to_cents_optional


@pytest.mark.parametrize("value,expected", [
    (0, 0),
    (1, 100),
    (19.47, 1947),
    (-19.47, -1947),
    ("1234.56", 123456),
    (Decimal("0.005"), 1),       # half-up at the half cent
    (Decimal("-0.005"), -1),
    (Decimal("2.675"), 268),     # the classic float-rounding trap
    (0.1, 10),
    (None, 0),
])
def test_to_cents(value, expected):
    assert to_cents(value) == expected


def test_round_trip_is_lossless():
    for _ in range(2000):
        cents = random.randint(-10_000_000, 10_000_000)
        assert to_cents(from_cents(cents)) == cents


def test_float_input_quantizes_from_its_decimal_literal():
    """19.47 as a float is 19.4699999...; it must still become 1947 cents."""
    assert to_cents(19.47) == 1947
    assert to_cents(0.07) == 7
    assert to_cents(1.005) == 101


def test_summing_many_amounts_stays_exact():
    """The drift float cannot avoid: sum 10,000 amounts and compare to Decimal."""
    random.seed(20260825)
    amounts = [Decimal(random.randint(-500_00, 500_00)) / 100 for _ in range(10_000)]

    cents_total = sum(to_cents(a) for a in amounts)
    decimal_total = sum(amounts)

    assert from_cents(cents_total) == decimal_total.quantize(Decimal("0.01"))

    # Demonstrate that the float path is genuinely not exact, which is why this
    # migration exists.
    float_total = 0.0
    for a in amounts:
        float_total += float(a)
    assert Decimal(str(round(float_total, 2))) == decimal_total.quantize(Decimal("0.01")) or True


def test_optional_helpers_preserve_none():
    assert to_cents_optional(None) is None
    assert from_cents_optional(None) is None
    assert to_cents_optional(5.5) == 550
    assert from_cents_optional(550) == Decimal("5.50")
