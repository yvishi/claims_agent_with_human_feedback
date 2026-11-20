"""Detect instructions inside documents. Documents are data: a hit only adds a flag.

Runs over text that is not a bill line. Stamp/signature phrases are allow-listed.
Iteration 2 adds an LLM yes/no confirmation on masked text.
"""
from __future__ import annotations

import re

PATTERNS = [
    r"\bapprove\b.*\b(in\s+full|claim|without)",
    r"without\s+(any\s+)?deductions?",
    r"note\s+to\s+(the\s+)?insurer",
    r"\binsurer\s*:",
    r"\bignore\b.*\b(rules?|instructions?|policy|limits?)",
    r"\bpay\s+(the\s+)?full\b",
]
ALLOW = [r"^authori[sz]ed\s+signatory", r"^approved\s+by\b", r"^verified\b"]


def find_instructions(other_text: list[str]) -> list[str]:
    hits = []
    for line in other_text:
        low = line.lower().strip()
        if any(re.search(a, low) for a in ALLOW):
            continue
        if any(re.search(p, low) for p in PATTERNS):
            hits.append(line)
    return hits
