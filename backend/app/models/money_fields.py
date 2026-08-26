"""Dollar-facing accessors over integer-cents columns.

Storage is exact integer minor units; ``*_cents`` is the only thing SQL and
arithmetic ever touch. These generated properties exist so model construction
(``Transaction(amount=...)``) and Pydantic response serialization can keep
speaking dollars, which keeps the HTTP contract unchanged.

Deliberately plain properties rather than hybrid_property: a plain property
raises immediately if someone tries to use it in a SQL filter, which forces the
exact ``*_cents`` column to be used for querying instead of silently emitting a
lossy expression.
"""
from decimal import Decimal

from app.core.money import from_cents, from_cents_optional, to_cents, to_cents_optional


def money_property(cents_attr: str, *, nullable: bool = False):
    """Build a Decimal-dollar property backed by an integer-cents column."""

    def getter(self) -> Decimal | None:
        raw = getattr(self, cents_attr)
        return from_cents_optional(raw) if nullable else from_cents(raw)

    def setter(self, value) -> None:
        setattr(self, cents_attr, to_cents_optional(value) if nullable else to_cents(value))

    getter.__name__ = cents_attr.removesuffix("_cents")
    return property(getter, setter)


def with_money(**fields: bool):
    """Class decorator adding dollar properties for the named cents columns.

    ``@with_money(amount=False, credit_limit=True)`` -- the bool is *nullable*.
    """

    def decorate(cls):
        for name, nullable in fields.items():
            setattr(cls, name, money_property(f"{name}_cents", nullable=nullable))
        return cls

    return decorate
