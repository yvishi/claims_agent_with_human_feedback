"""Money helpers. Every rupee is a Decimal, rounded half-up to paise after each step."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

PAISE = Decimal("0.01")
ZERO = Decimal("0.00")


def D(x) -> Decimal:
    """Exact Decimal from str/int/Decimal. Floats go through str() to avoid binary noise."""
    if isinstance(x, Decimal):
        return x
    if isinstance(x, float):
        return Decimal(str(x))
    return Decimal(x)


def r2(x: Decimal) -> Decimal:
    return D(x).quantize(PAISE, rounding=ROUND_HALF_UP)


def inr(x: Decimal) -> str:
    """Indian grouping for letters: 142000 -> 'Rs 1,42,000.00'."""
    x = r2(x)
    sign = "-" if x < 0 else ""
    whole, frac = f"{abs(x):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}Rs {whole}.{frac}"
