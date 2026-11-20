"""Advance a claim's graph until it closes or pauses. Iteration 1 runs in-process (no job queue yet).

    python -m harborline.runner CLM-2026-10416        # start or continue one claim
"""
from __future__ import annotations

import sys
from contextlib import contextmanager

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command
from psycopg import Connection
from psycopg.rows import dict_row

from harborline import store
from harborline.config import get_settings
from harborline.graph.build import build


@contextmanager
def graph():
    # prepare_threshold=0: safe behind poolers; autocommit as PostgresSaver requires.
    with Connection.connect(get_settings().app_db_url, autocommit=True, prepare_threshold=0,
                            row_factory=dict_row) as conn:
        saver = PostgresSaver(conn)
        saver.setup()
        yield build(saver)


def advance(claim_id: str, resume_value: dict | None = None) -> dict:
    """Start the thread if new, resume it if paused, no-op if closed. Returns the visible run state."""
    store.setup()
    cfg = {"configurable": {"thread_id": claim_id}}
    with graph() as g:
        snap = g.get_state(cfg)
        if not snap.values:
            g.invoke({"claim_id": claim_id}, cfg)
        elif snap.next:
            g.invoke(Command(resume=resume_value or {"by": "runner"}), cfg)
    return store.get_run(claim_id) or {}


if __name__ == "__main__":
    for cid in sys.argv[1:]:
        print(cid, advance(cid))
