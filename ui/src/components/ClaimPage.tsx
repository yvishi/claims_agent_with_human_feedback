import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle, ArrowLeft, Building2, CalendarDays, Check, ChevronDown, FileText, Hash, Info, Loader2, Lock, Mail, Upload, X,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ClaimDetail, type User } from "../api";
import { CATEGORY, DEDUCTION, DOC_LABEL, FLAG, REJECT, ROLE, STAGES, date, inrExact, stageIndex, statusLine, tone } from "../words";
import { Avatar, EASE, Pill, usePoll } from "./bits";
import { Timeline } from "./Timeline";

/* ---------- local building blocks ---------- */

/** A floating glass pane that rises into place. `strong` lifts it higher in the stack. */
function Pane({ children, className = "", delay = 0, strong = false }:
  { children: React.ReactNode; className?: string; delay?: number; strong?: boolean }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE, delay }}
      className={`${strong ? "glass-strong rounded-[28px]" : "glass"} min-w-0 p-5 sm:p-6 ${className}`}
    >
      {children}
    </motion.section>
  );
}

function PaneTitle({ children, icon, eyebrow }: { children: React.ReactNode; icon?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      {icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand ring-1 ring-inset ring-brand/15">{icon}</span>}
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      </div>
    </div>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-sunken/60 px-2.5 py-1 text-xs text-ink2 ring-1 ring-inset ring-line/70">
      <span className="shrink-0 text-ink3">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/* ---------- page ---------- */

export function ClaimPage({ user }: { user: User }) {
  const { id = "" } = useParams();
  const { data: c, error, refresh } = usePoll(() => api.claim(id), 2000, [id]);
  if (!c) {
    return (
      <div className="glass flex items-center gap-2 p-5 text-sm text-ink2">
        {error ? <>We couldn't open this claim. <Link to="/claims" className="font-medium text-brand underline underline-offset-2">All claims</Link></>
          : <><Loader2 className="animate-spin text-brand" size={16} /> Loading claim…</>}
      </div>
    );
  }

  const state = c.run?.state ?? "NOT_STARTED";
  const row = { state, waiting_for: c.waiting_for, paid_inr: c.payments[0]?.amount_inr ?? null, draft_decision: c.draft?.decision ?? null };
  const mine = c.waiting_for === user.role && !c.busy;
  // A claim whose last step failed sits still until someone resumes it.
  const stalled = !c.busy && state !== "CLOSED" && c.timeline[c.timeline.length - 1]?.event === "error";
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-w-0 space-y-5 sm:space-y-6">
        <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Link to="/claims" className="btn-ghost !px-3 !py-1.5 text-ink2 hover:text-ink"><ArrowLeft size={15} /> All claims</Link>
        </motion.div>

        <Hero c={c} mine={mine} row={row} />

        <Progress state={state} paid={c.payments.length > 0} />

        <div className="grid min-w-0 gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="order-2 min-w-0 space-y-5 sm:space-y-6 lg:order-1">
            {!c.run && <StartCard id={c.claim_id} onStarted={refresh} />}
            {stalled && <RetryCard id={c.claim_id} onRetried={refresh} />}
            {!c.draft && c.run && !stalled && state !== "WAITING_FOR_DOCS" && (
              <Pane delay={0.16}>
                <p className="flex items-center gap-2.5 text-sm text-ink2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand"><Loader2 size={15} className="animate-spin" /></span>
                  We're assessing this claim. The amount will appear here shortly.
                </p>
              </Pane>
            )}
            {c.draft && <Summary c={c} />}
            {c.draft && <Fold title="Bill details" delay={0.22}><BillLines c={c} /></Fold>}
            <Fold title="Policy details" delay={0.26}><PolicyFacts c={c} /></Fold>
            {c.letter && <Fold title="Letter to the member" delay={0.3}><Letter body={c.letter.body} /></Fold>}
            <Fold title="Claim history" delay={0.34}><Timeline events={c.timeline} /></Fold>
          </div>
          <div className="order-1 min-w-0 space-y-5 sm:space-y-6 lg:order-2">
            <Decision c={c} user={user} onDone={refresh} />
            {state === "WAITING_FOR_DOCS" && <DocsWaiting c={c} onSent={refresh} />}
            {c.draft && (c.draft.flags.length > 0 || c.draft.review_reasons.length > 0) && <Concerns c={c} />}
            <Payment c={c} />
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}

function Hero({ c, mine, row }: { c: ClaimDetail; mine: boolean; row: Parameters<typeof statusLine>[0] & Parameters<typeof tone>[0] }) {
  const paid = c.payments[0];
  const d = c.draft;
  const key = paid ? { label: "Paid", value: inrExact(paid.amount_inr), sub: date(paid.created_at) }
    : d ? (d.decision === "reject"
      ? { label: "Recommended", value: "Not payable", sub: `${inrExact(d.claimed_inr)} claimed` }
      : { label: "Recommended", value: inrExact(d.payable_inr), sub: `of ${inrExact(d.claimed_inr)} claimed` })
    : null;
  return (
    <Pane strong delay={0.02} className="relative overflow-hidden">
      {/* soft light caught by the pane */}
      <span aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-sky/30 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full bg-mist/30 blur-3xl" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar name={c.member.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="eyebrow">Claim for</div>
            <h1 className="break-words text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{c.member.name}</h1>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip icon={<Hash size={12} />}><span className="tabular">{c.claim_id}</span></Chip>
              <Chip icon={<Building2 size={12} />}>{c.hospital.name}{c.hospital.city ? `, ${c.hospital.city}` : ""}</Chip>
              <Chip icon={<CalendarDays size={12} />}>{date(c.claim.admission_date)} – {date(c.claim.discharge_date)}</Chip>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 border-t border-line/70 pt-4 sm:items-end sm:border-0 sm:pt-0 sm:text-right">
          <Pill tone={mine ? "warn" : tone(row)} spin={c.busy}>{mine ? "Needs your decision" : statusLine(row)}</Pill>
          {key && (
            <div>
              <div className="eyebrow">{key.label}</div>
              <div className="text-3xl font-semibold tracking-tight text-ink tabular sm:text-4xl">{key.value}</div>
              <div className="text-xs text-ink3 tabular">{key.sub}</div>
            </div>
          )}
        </div>
      </div>
    </Pane>
  );
}

function RetryCard({ id, onRetried }: { id: string; onRetried: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pane delay={0.14} className="ring-1 ring-inset ring-warn/40">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn/15 ring-1 ring-inset ring-warn/35">
            <AlertTriangle size={17} className="text-[rgb(158_104_0)] dark:text-warn" />
          </span>
          <div className="min-w-[12rem] flex-1">
            <div className="text-sm font-semibold text-ink">Processing paused</div>
            <div className="text-sm text-ink2">A temporary problem stopped this claim. It will continue from where it stopped.</div>
          </div>
        </div>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await api.start(id); } finally { setBusy(false); onRetried(); } }}
          className="btn-primary">{busy ? <><Loader2 size={15} className="animate-spin" /> Retrying…</> : "Try again"}</button>
      </div>
    </Pane>
  );
}

/** A section that starts closed, so the page shows the essentials first. */
function Fold({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.section
      initial={{ opacity: 0, y: 18, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE, delay }}
      className="glass min-w-0 overflow-hidden"
    >
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="group flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[rgb(var(--glass)/0.35)] sm:px-6">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-all duration-300
          ${open ? "bg-brand/10 text-brand ring-brand/25" : "bg-sunken/60 text-ink3 ring-line/70 group-hover:text-ink2"}`}>
          <ChevronDown size={16} className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.38, ease: EASE }} className="overflow-hidden">
            <div className="border-t border-line/60 px-5 pb-5 pt-4 sm:px-6">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/** The member letter, as a sheet of paper floating inside its pane. */
function Letter({ body }: { body: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10, rotate: -0.4 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.08 }}
      className="relative mx-auto max-w-2xl rounded-2xl bg-raised p-5 shadow-float ring-1 ring-line/70 sm:p-8">
      <div className="mb-4 flex items-center gap-2 border-b border-line/70 pb-3 text-ink3">
        <FileText size={14} />
        <span className="eyebrow">Harborline Claims</span>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">{body}</pre>
    </motion.div>
  );
}

function StartCard({ id, onStarted }: { id: string; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pane delay={0.14}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[12rem] flex-1">
          <div className="text-sm font-semibold text-ink">Ready to assess</div>
          <p className="text-sm text-ink2">This claim is new and hasn't been assessed yet.</p>
        </div>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await api.start(id); } finally { setBusy(false); onStarted(); } }}
          className="btn-primary">{busy && <Loader2 size={15} className="animate-spin" />}Start assessment</button>
      </div>
    </Pane>
  );
}

function Progress({ state, paid }: { state: string; paid: boolean }) {
  const current = stageIndex(state);
  const waiting = state.startsWith("WAITING");
  const closedUnpaid = state === "CLOSED" && !paid;
  const reduce = useReducedMotion();
  return (
    <Pane delay={0.08} className="!px-2 !py-4 sm:!px-6 sm:!py-5">
      <ol className="grid grid-cols-5" aria-label="Claim progress">
        {STAGES.map((s, i) => {
          const done = i < current;
          const here = i === current;
          const skipped = closedUnpaid && s.key === "payment";
          const node = skipped ? "bg-sunken/80 text-ink3 ring-1 ring-inset ring-line"
            : done ? "bg-gradient-to-b from-brand to-brand/85 text-onbrand shadow-[0_6px_16px_-6px_rgb(var(--brand)/0.8)]"
            : here ? (waiting
              ? "bg-warn/20 text-ink ring-2 ring-inset ring-warn shadow-[0_0_22px_-2px_rgb(var(--warn)/0.65)]"
              : "pulse-ring bg-raised text-brand ring-2 ring-inset ring-brand shadow-[0_0_22px_-2px_rgb(var(--brand)/0.6)]")
            : "bg-sunken/60 text-ink3 ring-1 ring-inset ring-line";
          return (
            <li key={s.key} className="flex min-w-0 flex-col items-center text-center" aria-current={here ? "step" : undefined}>
              <div className="flex w-full items-center">
                <span className={`h-[3px] flex-1 rounded-full transition-colors duration-500 ${i === 0 ? "opacity-0" : done || here ? "bg-brand/80" : "bg-line/80"}`} />
                <span className="relative flex h-8 w-8 shrink-0 sm:h-10 sm:w-10">
                  {here && waiting && !reduce && (
                    <motion.span aria-hidden className="absolute inset-0 rounded-full bg-warn/40"
                      animate={{ scale: [1, 1.55], opacity: [0.55, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }} />
                  )}
                  <span className={`relative flex h-full w-full items-center justify-center rounded-full transition-all duration-500 ${node}`}>
                    {done && !skipped ? <Check size={16} strokeWidth={2.5} /> : <s.icon size={15} />}
                  </span>
                </span>
                <span className={`h-[3px] flex-1 rounded-full transition-colors duration-500 ${i === STAGES.length - 1 ? "opacity-0" : done ? "bg-brand/80" : "bg-line/80"}`} />
              </div>
              <span className={`mt-2 w-full break-words px-0.5 text-[10px] font-semibold leading-tight sm:text-xs ${done || here ? "text-ink" : "text-ink3"}`}>{s.label}</span>
              {here && waiting && <span className="mt-0.5 text-[10px] font-medium text-[rgb(158_104_0)] dark:text-warn sm:text-[11px]">Waiting</span>}
              {skipped && <span className="mt-0.5 text-[10px] text-ink3 sm:text-[11px]">Not paid</span>}
            </li>
          );
        })}
      </ol>
    </Pane>
  );
}

/** Paid vs deducted, one bar. Values are written out in ink so they read at any contrast. */
function SplitBar({ payable, claimed }: { payable: number; claimed: number }) {
  const deducted = Math.max(0, claimed - payable);
  const pct = claimed > 0 ? Math.min(100, Math.max(0, (payable / claimed) * 100)) : 100;
  return (
    <div className="mt-5">
      <div className="flex h-3 gap-[2px]" role="img" aria-label={`${inrExact(payable)} payable, ${inrExact(deducted)} deducted`}>
        {payable > 0 && (
          <motion.span className="h-full rounded-[4px]" style={{ background: "rgb(var(--paid))" }}
            initial={{ width: 0 }} animate={{ width: deducted > 0.005 ? `${pct}%` : "100%" }} transition={{ duration: 0.8, ease: EASE, delay: 0.25 }} />
        )}
        {deducted > 0.005 && <span className="h-full min-w-[4px] flex-1 rounded-[4px]" style={{ background: "rgb(var(--deduct))" }} />}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 text-ink2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "rgb(var(--paid))" }} aria-hidden />
          Payable <b className="font-semibold text-ink tabular">{inrExact(payable)}</b>
        </span>
        {deducted > 0.005 && (
          <span className="inline-flex items-center gap-1.5 text-ink2">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "rgb(var(--deduct))" }} aria-hidden />
            Deducted <b className="font-semibold text-ink tabular">{inrExact(deducted)}</b>
          </span>
        )}
      </div>
    </div>
  );
}

/** Claimed → each deduction with its reason → payable. */
function Summary({ c }: { c: ClaimDetail }) {
  const d = c.draft!;
  const claimed = Number(d.claimed_inr);
  if (d.decision === "reject") {
    return (
      <Pane delay={0.18}>
        <PaneTitle eyebrow="Assessment" icon={<X size={15} />}>Outcome</PaneTitle>
        <div className="text-3xl font-semibold tracking-tight text-ink">Not payable</div>
        <p className="mt-1.5 text-ink2">{REJECT[d.reject_code ?? ""] ?? "The policy doesn't cover this claim."}</p>
        <div className="well mt-4 inline-flex px-3 py-2 text-sm text-ink2">Amount claimed: <b className="ml-1 font-semibold text-ink tabular">{inrExact(claimed)}</b></div>
      </Pane>
    );
  }
  const payable = Number(d.payable_inr);
  const rows: { label: string; why?: string; amount: number }[] = [];
  const gap = claimed - d.deductions.reduce((s, x) => s + Number(x.amount_inr), 0) - payable;
  if (gap > 0.01) rows.push({ label: "Bill items total less than claimed", why: "We pay what the bill's items add up to.", amount: gap });
  for (const x of d.deductions) rows.push({ label: DEDUCTION[x.code] ?? "Deduction", why: x.why, amount: Number(x.amount_inr) });
  const edit = [...c.approvals].reverse().find((a) => a.action === "edit");
  return (
    <Pane delay={0.18}>
      <div className="eyebrow">Assessment</div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="text-sm text-ink2">Payable</div>
          <div className="text-4xl font-semibold tracking-tight text-ink tabular">{inrExact(payable)}</div>
        </div>
        <div className="text-sm text-ink2 tabular">of {inrExact(claimed)} claimed</div>
      </div>
      <SplitBar payable={payable} claimed={claimed} />
      {rows.length > 0 ? (
        <div className="well mt-5 px-4 py-1">
          <ul className="divide-y divide-line/70">
            {rows.map((r, i) => (
              <motion.li key={r.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.3 + i * 0.05 }}
                className="flex items-start justify-between gap-4 py-3">
                <div className="flex min-w-0 gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "rgb(var(--deduct))" }} aria-hidden />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{r.label}</div>
                    {r.why && <div className="text-sm text-ink2">{r.why}</div>}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-ink tabular">−{inrExact(r.amount)}</div>
              </motion.li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-5 flex items-center gap-2 text-sm text-ink2"><Check size={15} className="text-good" /> No deductions. The full amount is covered.</p>
      )}
      {edit?.amount && (
        <div className="mt-4 rounded-2xl bg-brand/[0.07] p-3.5 text-sm text-ink ring-1 ring-inset ring-brand/15">
          <b>{edit.name}</b> changed the amount to <b className="tabular">{inrExact(edit.amount)}</b>
          {edit.reason && <div className="mt-0.5 text-ink2">“{edit.reason}”</div>}
        </div>
      )}
    </Pane>
  );
}

function BillLines({ c }: { c: ClaimDetail }) {
  const lines = c.draft!.line_items;
  return (
    <>
      <ul className="divide-y divide-line/70">
        {lines.map((l) => {
          const billed = Number(l.billed_inr), paid = Number(l.payable_after_step2_inr);
          const cut = paid < billed;
          return (
            <li key={`${l.bill_no}-${l.line_no}`} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="break-words text-sm text-ink">{l.description}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink3">
                  {CATEGORY[l.category ?? ""]?.label ?? "Uncategorised"}
                  {cut && (
                    <span className="inline-flex items-center gap-1 text-ink2">
                      · <span className="h-1.5 w-1.5 rounded-full" style={{ background: "rgb(var(--deduct))" }} aria-hidden />
                      {lineReason(l.category, l.deduction_code)}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right text-sm tabular">
                <div className="font-semibold text-ink">{inrExact(paid)}</div>
                {cut && <div className="text-xs text-ink3 line-through">{inrExact(billed)}</div>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink3">Item amounts are before any overall limits shown in the assessment.</p>
    </>
  );
}

function lineReason(category: string | null, code: string | null) {
  if (code === "NON_PAYABLE") return "Not covered";
  if (code === "ROOM_RENT_PROPORTIONATE") return category === "room" || category === "icu" ? "Paid at the daily room limit" : "Reduced in line with the room limit";
  return "Reduced";
}

function PolicyFacts({ c }: { c: ClaimDetail }) {
  const facts = [
    ["Plan", c.policy.plan ?? "—"],
    ["Status", c.policy.status],
    ["Sum insured", inrExact(c.policy.sum_insured_inr)],
    ["Cover remaining", inrExact(c.policy.remaining_inr)],
    ["Policy year", `${date(c.policy.period_start)} – ${date(c.policy.period_end)}`],
    ["Member since", date(c.policy.inception_date)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:grid-cols-3">
      {facts.map(([k, v]) => (
        <div key={k} className="well min-w-0 px-3.5 py-3">
          <dt className="eyebrow">{k}</dt>
          <dd className="mt-1 break-words text-sm font-semibold capitalize text-ink tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Concerns({ c }: { c: ClaimDetail }) {
  const d = c.draft!;
  const unsure = d.review_reasons.some((r) => r.startsWith("LOW_CONFIDENCE") || r.startsWith("Unclassified"));
  return (
    <Pane delay={0.2}>
      <PaneTitle icon={<AlertTriangle size={15} />}>Please check</PaneTitle>
      <ul className="space-y-2">
        {d.flags.map((f) => (
          <li key={f} className="well flex gap-3 p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[rgb(168_72_34)] dark:text-serious" />
            <div className="min-w-0"><div className="text-sm font-medium text-ink">{FLAG[f]?.title ?? "Needs a look"}</div>{FLAG[f] && <div className="text-sm text-ink2">{FLAG[f].body}</div>}</div>
          </li>
        ))}
        {unsure && (
          <li className="well flex gap-3 p-3">
            <Info size={16} className="mt-0.5 shrink-0 text-ink2" />
            <div className="min-w-0"><div className="text-sm font-medium text-ink">Hard to read</div><div className="text-sm text-ink2">Part of a document was unclear. Please check the bill details.</div></div>
          </li>
        )}
      </ul>
    </Pane>
  );
}

function Decision({ c, user, onDone }: { c: ClaimDetail; user: User; onDone: () => void }) {
  const [mode, setMode] = useState<"none" | "edit" | "reject">("none");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const d = c.draft;

  if (!d || !c.waiting_for || c.waiting_for === "member") {
    if (!c.approvals.length) return null;
    return (
      <Pane delay={0.12}>
        <PaneTitle icon={<Check size={15} />}>Decision</PaneTitle>
        <ul className="space-y-2">
          {c.approvals.map((a) => (
            <li key={a.step} className="well flex items-start gap-3 p-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-good/15 text-good ring-1 ring-inset ring-good/30"><Check size={13} strokeWidth={2.5} /></span>
              <div className="min-w-0 text-ink">
                {a.actor === "system:auto" ? <>Approved automatically{a.amount ? ` for ${inrExact(a.amount)}` : ""}</>
                  : <><b>{a.name}</b> {a.action === "approve" ? "approved" : a.action === "edit" ? "approved a changed amount of" : "rejected the claim"}{a.amount && a.action !== "reject" ? ` ${inrExact(a.amount)}` : ""}</>}
                {a.reason && <div className="text-ink2">“{a.reason}”</div>}
                <div className="mt-0.5 text-xs text-ink3">{date(a.at)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Pane>
    );
  }

  const mine = c.waiting_for === user.role && !c.busy;
  const proposeReject = d.decision === "reject";
  const send = async (action: string) => {
    setErr(null); setSending(true);
    try {
      await api.act(c.claim_id, { action, reason: reason || undefined, amount_inr: action === "edit" ? Number(amount) : undefined });
      setMode("none"); setReason(""); setAmount(""); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setSending(false); }
  };
  return (
    <Pane strong delay={0.12} className={`lg:sticky lg:top-20 ${mine ? "ring-1 ring-inset ring-brand/30" : ""}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{mine ? "Your decision" : "Awaiting decision"}</h2>
        {mine && <span className="h-2 w-2 rounded-full bg-brand shadow-[0_0_10px_rgb(var(--brand)/0.8)]" aria-hidden />}
      </div>
      <div className="well mb-5 p-4">
        <div className="eyebrow">Recommended</div>
        <div className="mt-1 break-words text-3xl font-semibold tracking-tight text-ink tabular sm:text-4xl">{proposeReject ? "Not payable" : inrExact(d.payable_inr)}</div>
        <div className="mt-0.5 text-sm text-ink2">{proposeReject ? REJECT[d.reject_code ?? ""] ?? "Not covered by the policy" : `of ${inrExact(d.claimed_inr)} claimed`}</div>
      </div>
      {!mine ? (
        <p className="flex items-center gap-2 text-sm text-ink2">
          {c.busy ? <><Loader2 size={15} className="animate-spin text-brand" /> Updating…</>
            : <><Lock size={15} className="text-ink3" /> Waiting for a {ROLE[c.waiting_for as keyof typeof ROLE]?.toLowerCase()}.</>}
        </p>
      ) : (
        <div className="space-y-2.5">
          {!proposeReject && (
            <button disabled={sending} onClick={() => send("approve")} className="btn-primary w-full !py-3 text-[15px]">
              <Check size={17} strokeWidth={2.5} /> Approve {inrExact(d.payable_inr)}
            </button>
          )}
          <div className={`grid gap-2 ${user.role === "claims_processor" ? "grid-cols-2" : "grid-cols-1"}`}>
            <button onClick={() => setMode(mode === "edit" ? "none" : "edit")} aria-pressed={mode === "edit"}
              className={`btn-ghost min-w-0 px-3 ${mode === "edit" ? "!text-brand ring-2 ring-inset ring-brand/50" : ""}`}>
              {proposeReject ? "Pay an amount" : "Change amount"}
            </button>
            {user.role === "claims_processor" && (
              <button onClick={() => { setMode(mode === "reject" ? "none" : "reject"); if (proposeReject && !reason) setReason(REJECT[d.reject_code ?? ""] ?? ""); }}
                aria-pressed={mode === "reject"}
                className={`btn-ghost min-w-0 px-3 ${mode === "reject" ? "!text-crit ring-2 ring-inset ring-crit/50" : ""}`}>
                {proposeReject ? "Confirm rejection" : "Reject"}
              </button>
            )}
          </div>
          <AnimatePresence>
            {mode !== "none" && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.32, ease: EASE }} className="overflow-hidden">
                <div className="space-y-3 pt-2">
                  {mode === "edit" && (
                    <label className="block text-sm font-medium text-ink2">New amount (₹)
                      <input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                        className="field mt-1.5 tabular" />
                    </label>
                  )}
                  <label className="block text-sm font-medium text-ink2">Reason <span className="font-normal text-ink3">(shown to the member)</span>
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="field mt-1.5 resize-y" />
                  </label>
                  <button disabled={sending || !reason.trim() || (mode === "edit" && !amount)} onClick={() => send(mode)}
                    className={`${mode === "reject" ? "btn-danger" : "btn-primary"} w-full !py-2.5`}>
                    {sending && <Loader2 size={15} className="animate-spin" />}
                    {mode === "reject" ? "Reject claim" : "Approve new amount"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {err && <p className="rounded-xl bg-crit/10 px-3 py-2 text-sm text-crit ring-1 ring-inset ring-crit/25">{err}</p>}
        </div>
      )}
    </Pane>
  );
}

function DocsWaiting({ c, onSent }: { c: ClaimDetail; onSent: () => void }) {
  const asked = c.emails.filter((e) => e.kind === "docs_request");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.deliverMissing(c.claim_id);
      if (!r.delivered.length) setErr("There was nothing new to send.");
    } catch { setErr("We couldn't send the document. Please try again."); }
    finally { setBusy(false); onSent(); }
  };
  return (
    <Pane delay={0.16} className="ring-1 ring-inset ring-warn/35">
      <PaneTitle icon={<Mail size={15} />}>Waiting for documents</PaneTitle>
      <ul className="space-y-2">
        {asked.map((e) => (
          <li key={e.idempotency_key} className="well flex items-start gap-3 p-3 text-sm">
            <Mail size={16} className="mt-0.5 shrink-0 text-brand" />
            <div className="min-w-0 text-ink">Requested the <b>{DOC_LABEL[e.doc_type ?? ""] ?? "missing document"}</b><div className="text-xs text-ink3">{date(e.sent_at)}</div></div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink2">The claim continues automatically once the member sends it.</p>
      {c.pending_files.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs text-ink3">For this demo, you can send the member's document on their behalf.</p>
          <button disabled={busy || c.busy} onClick={send} className="btn-primary mt-2.5 w-full justify-center">
            {busy ? <><Loader2 size={15} className="animate-spin" /> Sending…</>
              : <><Upload size={15} /> Send the member's {c.pending_files.length > 1 ? "documents" : "document"}</>}
          </button>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-crit">{err}</p>}
    </Pane>
  );
}

function Payment({ c }: { c: ClaimDetail }) {
  const p = c.payments[0];
  const status = c.payment_status?.status;
  if (!p && !status) return null;
  return (
    <Pane delay={0.2}>
      <div className="eyebrow mb-3">Payment</div>
      {p ? (
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-good/15 text-good ring-1 ring-inset ring-good/35 shadow-[0_0_20px_-4px_rgb(var(--good)/0.6)]"><Check size={20} strokeWidth={2.5} /></span>
          <div className="min-w-0">
            <div className="text-xl font-semibold text-ink tabular">{inrExact(p.amount_inr)} paid</div>
            <div className="break-words text-xs text-ink3">{date(p.created_at)} · to {c.payee.name ?? "the member"} ({c.payee.account})</div>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink2">
          {status === "payout_blocked_balance" ? <><AlertTriangle size={15} className="shrink-0 text-[rgb(158_104_0)] dark:text-warn" /> On hold: not enough cover remaining. Sent back for review.</>
            : status === "payout_stuck" ? <><AlertTriangle size={15} className="shrink-0 text-[rgb(158_104_0)] dark:text-warn" /> Payment is delayed.</>
            : <><Loader2 size={15} className="animate-spin text-brand" /> Payment in progress…</>}
        </p>
      )}
    </Pane>
  );
}
