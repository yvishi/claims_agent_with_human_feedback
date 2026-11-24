# Harborline Claims Agent

Team Alpha, Build Fast with AI FDE Fellowship, Week 3. A claims agent with human approval for
Harborline Health Insurance (fictional). Synthetic data only.

Work in progress: see the iteration notes below as they are added.

## Iteration 1: run it locally

Needs Python 3.12, Tesseract (`brew install tesseract`), and two Postgres databases (we use Neon:
`claims_app` and `harborline_mock`). The claim pack sits next to this repo (`CLAIM_PACK_DIR`).

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill APP_DB_URL and MOCK_DB_URL (direct, non-pooler Neon URLs)
.venv/bin/python -m pytest -q   # rules engine unit tests
.venv/bin/python -m harness.offline              # drafts only, straight from the PDFs, graded
.venv/bin/uvicorn harborline.mocks.app:app --port 8001   # mock services (terminal 1)
.venv/bin/python -m harness.run                  # all 30 claims through the graph, graded (terminal 2)
```

Payment faults: start the mocks with `FAULT_MODE=on` (claims in the pack's `run_config.json`),
`FAULT_MODE=all` (every claim), and optionally `FAULT_FORCE=timeout_first` for a guaranteed
record-then-hang on the first call.

### Agents

One LangGraph state machine (`harborline/graph/build.py`, thread per claim, Postgres checkpoints)
wires narrow agents; code, not an LLM, decides the order:

| Agent | Module | LLM |
|---|---|---|
| Intake (checklist, document requests, wait) | `agents/intake.py` | no |
| Bill reader (local text/OCR, parse, classify, instruction check) | `agents/bill_reader.py`, `docs/` | not yet (iteration 2: leftovers only, masked) |
| Adjudicator (P1-P10, Decimal) | `agents/adjudicator.py`, `rules/` | never |
| Approval (rows in the DB, permissions) | `agents/approval.py` | no |
| Payout (gate, look-first, balance lock, retries) | `agents/payout.py` | no |
| Letter (template; LLM draft in iteration 2) | `agents/letter.py` | not yet |

### Iteration 1 results

- Offline drafts and full graph run: 30/30 on every `grade.py` check, 0 duplicate payments, ~12 s per claim.
- C-10 with a forced post-record timeout: the payout looks again, adopts the recorded payment, pays once.

### Decisions so far

- In payout, look-first runs before the balance re-check, so a payment we already recorded can never be
  blocked by the balance it used up (a change from ARCHITECTURE v2).
- Cataract sub-limit applies to the running payable after steps 1-2 (matches C-16).
- Prescription is required only when a separate pharmacy bill is claimed (C-01 vs C-20).
- An OCR mean word confidence below 70, or a bill line whose qty x rate != amount, forces review.

## Claims console (client-facing UI)

React + TypeScript + Tailwind + Framer Motion in `ui/`, served by the console API.

```bash
cd ui && npm install && npm run build && cd ..          # build once (or `npm run dev` on :5173 for live editing)
.venv/bin/uvicorn harborline.mocks.app:app --port 8001   # terminal 1: mock services
.venv/bin/uvicorn harborline.api.app:app --port 8000     # terminal 2: console API + built UI
# open http://127.0.0.1:8000 and sign in as Asha Pillai, Deepak Rao or Sunil Varma
```

What it shows, in plain language for non-technical readers:

- **Claims desk**: headline numbers, a live board where each claim glides between six lanes as the agent
  works, and a filterable list ("Waiting for me", "In progress", ...).
- **Claim page**: a nine-step journey, "Where the money went" (claimed → each deduction → payable, with the
  reason on hover), every bill line with a paid/deducted bar and its evidence, policy facts, the decision
  panel (approve / change amount / reject, with reasons), the payment with the "safety net" story when a
  payment timed out, the settlement letter, and the audit trail told as a story.
- **How it works**: an animated walk-through of the claim's path, who does what (agent, rules, person,
  AI helper), and the three promises (private, paid exactly once, every rupee explained).

Chart colours (paid `#2a78d6` / deducted `#eb6834`, dark-mode steps `#3987e5` / `#d95926`) pass the
colour-blind separation and contrast checks; every status also carries an icon and words.

## Branches

`main` is production, `dev` is integration. Each feature has its own branch cut from `dev`, so a fix goes
on that feature's branch and merges back through `dev`:
`feature/iteration-1`, `feature/pii-masking`, `feature/llm-classifier`, `feature/console-api`,
`feature/console-ui`, `fix/db-pool-reconnect`.
