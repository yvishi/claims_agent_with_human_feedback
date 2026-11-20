import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, FileText, Hospital, Info, Loader2, Lock, Mail, ShieldCheck, Upload,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ClaimDetail, type User } from "../api";
import {
  CATEGORY, DOC_LABEL, FLAG, REJECT, ROLE, STAGES, date, inrExact, stageIndex, statusLine, time, tone,
} from "../words";
import { Avatar, Card, Pill, usePoll } from "./bits";
import { MoneyStory } from "./MoneyStory";
import { Timeline } from "./Timeline";

export function ClaimPage({ user }: { user: User }) {
  const { id = "" } = useParams();
  const { data: c, refresh } = usePoll(() => api.claim(id), 1500, [id]);
  if (!c) return <div className="flex items-center gap-2 text-ink2"><Loader2 className="animate-spin" size={16} /> Loading claim…</div>;

  const row = { state: c.run?.state ?? "NOT_STARTED", waiting_for: c.waiting_for, paid_inr: c.payments[0]?.amount_inr ?? null, draft_decision: c.draft?.decision ?? null };
  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-ink2 hover:text-ink"><ArrowLeft size={15} /> Claims desk</Link>

      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={c.member.name} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.member.name}</h1>
            {c.case && <span className="rounded bg-sunken px-2 py-0.5 text-xs font-semibold text-ink2">{c.case}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink2">
            <span className="tabular">{c.claim_id}</span>
            <span className="flex items-center gap-1"><Hospital size={14} /> {c.hospital.name}, {c.hospital.city}</span>
            <span>{date(c.claim.admission_date)} – {date(c.claim.discharge_date)}</span>
            <span className="capitalize">{c.claim.cause}</span>
          </div>
          {c.scenario && <div className="mt-1 text-sm text-ink3">Scenario: {c.scenario}</div>}
        </div>
        <Pill tone={tone(row)} spin={c.busy}>{statusLine(row)}</Pill>
      </div>

      <Journey c={c} />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {!c.run && <StartCard id={c.claim_id} onStarted={refresh} />}
          {c.draft && <MoneyStory c={c} />}
          {c.draft && <BillLines c={c} />}
          <PolicyFacts c={c} />
          {c.letter && <Letter body={c.letter.body} template={c.letter.template} />}
        </div>
        <div className="space-y-6">
          <Decision c={c} user={user} onDone={refresh} />
          {c.run?.state === "WAITING_FOR_DOCS" && <DocsWaiting c={c} onDone={refresh} />}
          {c.draft && (c.draft.flags.length > 0 || c.draft.review_reasons.length > 0) && <Concerns c={c} />}
          <Payment c={c} />
          <Card title="What happened"><Timeline events={c.timeline} /></Card>
        </div>
      </div>
    </div>
  );
}

function StartCard({ id, onStarted }: { id: string; onStarted: () => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink2">This claim hasn't been picked up yet.</p>
        <button onClick={async () => { await api.start(id); onStarted(); }}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white">Start processing</button>
      </div>
    </Card>
  );
}

/** Nine friendly steps. Done steps fill in, the current one pulses, waiting steps glow amber. */
function Journey({ c }: { c: ClaimDetail }) {
  const state = c.run?.state ?? "NOT_STARTED";
  const current = stageIndex(state);
  const firstAt: Record<number, string> = {};
  for (const e of c.timeline) if (e.event === "state" && e.state) {
    const i = stageIndex(e.state);
    if (i >= 0 && !(i in firstAt)) firstAt[i] = e.at;
  }
  const rejected = state === "CLOSED" && c.payments.length === 0;
  const waiting = state.startsWith("WAITING");
  return (
    <Card>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <ol className="relative flex min-w-[760px] items-start justify-between">
          <div className="absolute left-5 right-5 top-5 h-0.5 bg-line" />
          <motion.div className="absolute left-5 top-5 h-0.5 bg-brand" initial={{ width: 0 }}
            animate={{ width: current <= 0 ? 0 : `calc((100% - 40px) * ${current / (STAGES.length - 1)})` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
          {STAGES.map((s, i) => {
            const done = i < current || state === "CLOSED";
            const here = i === current && state !== "CLOSED";
            const skipped = rejected && s.key === "payment";
            const Icon = s.icon;
            return (
              <li key={s.key} className="relative z-10 flex w-[84px] flex-col items-center text-center">
                <motion.span layout
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors
                    ${skipped ? "border-line bg-sunken text-ink3" : done ? "border-brand bg-brand text-white"
                      : here ? (waiting ? "border-warn bg-warn/20 text-ink pulse-ring" : "border-brand bg-raised text-brand pulse-ring")
                      : "border-line bg-raised text-ink3"}`}>
                  {done && !skipped ? <Check size={18} /> : <Icon size={18} />}
                </motion.span>
                <span className={`mt-2 text-xs font-medium ${here || done ? "text-ink" : "text-ink3"}`}>{s.label}</span>
                <span className="text-[11px] text-ink3">{skipped ? "Skipped" : here && waiting ? "Waiting" : firstAt[i] ? time(firstAt[i]) : ""}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}

function lineReason(category: string | null, code: string | null) {
  if (code === "NON_PAYABLE") return "Not covered by the policy (a personal or admin item).";
  if (code === "ROOM_RENT_PROPORTIONATE")
    return category === "room" || category === "icu"
      ? "Paid at the policy's daily limit for this kind of room."
      : "Paid in the same proportion as the room, because the room cost more than the daily limit.";
  return "";
}

function BillLines({ c }: { c: ClaimDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  const lines = c.draft!.line_items;
  const bills = [...new Set(lines.map((l) => l.bill_no))];
  return (
    <Card title="Every line on the bill" action={
      <span className="flex items-center gap-3 text-xs text-ink2">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-paid" /> Paid</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-deduct" /> Deducted</span>
      </span>}>
      {bills.map((bill) => (
        <div key={bill} className="mb-4 last:mb-0">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink3"><FileText size={13} /> Bill {bill}</div>
          <ul className="divide-y divide-line">
            {lines.filter((l) => l.bill_no === bill).map((l, i) => {
              const billed = Number(l.billed_inr), paid = Number(l.payable_after_step2_inr);
              const key = `${l.bill_no}-${l.line_no}`;
              const cut = paid < billed;
              const cat = CATEGORY[l.category ?? ""];
              return (
                <li key={key} className="py-2.5">
                  <button onClick={() => cut && setOpen(open === key ? null : key)}
                    className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 text-left sm:grid-cols-[minmax(0,1fr)_130px_92px_92px] ${cut ? "cursor-pointer" : "cursor-default"}`}>
                    <div className="min-w-0">
                      <div className="truncate text-sm">{l.description}</div>
                      <span title={cat?.hint} className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${l.category === "non_payable" ? "bg-deduct/15 text-[rgb(var(--deduct))]" : "bg-sunken text-ink2"}`}>
                        {cat?.label ?? "Needs a person to label"}
                      </span>
                    </div>
                    <div className="order-last col-span-2 flex h-2 w-full gap-[2px] sm:order-none sm:col-span-1">
                      <motion.span className="h-full rounded-l-[4px] bg-paid" style={{ borderRadius: cut ? undefined : 4 }}
                        initial={{ width: 0 }} animate={{ width: `${(paid / billed) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.04 }} />
                      {cut && <motion.span className="h-full rounded-r-[4px] bg-deduct"
                        initial={{ width: 0 }} animate={{ width: `${((billed - paid) / billed) * 100}%` }} transition={{ duration: 0.7, delay: 0.3 + i * 0.04 }} />}
                    </div>
                    <div className="hidden text-right text-sm text-ink2 tabular sm:block">{inrExact(billed)}</div>
                    <div className="flex items-center justify-end gap-1 text-right text-sm font-medium tabular">
                      {inrExact(paid)} {cut && <ChevronDown size={14} className={`text-ink3 transition-transform ${open === key ? "rotate-180" : ""}`} />}
                    </div>
                  </button>
                  <AnimatePresence>
                    {open === key && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="mt-2 rounded-xl bg-sunken p-3 text-sm">
                          <div className="font-medium">Why {inrExact(billed - paid)} was deducted</div>
                          <div className="mt-1 text-ink2">{lineReason(l.category, l.deduction_code)}</div>
                          {l.evidence && (
                            <div className="mt-2 text-xs text-ink3">
                              Evidence: {l.evidence.file}, line {l.evidence.source_line}
                              <code className="mt-1 block overflow-x-auto whitespace-pre rounded-lg bg-raised p-2 font-mono text-[11px] text-ink2">{l.evidence.text}</code>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="mt-2 text-xs text-ink3">Tap a line with a deduction to see why. Amounts here are before co-pay, treatment limits and remaining cover.</p>
    </Card>
  );
}

function PolicyFacts({ c }: { c: ClaimDetail }) {
  const facts = [
    ["Plan", c.policy.plan],
    ["Sum insured", inrExact(c.policy.sum_insured_inr)],
    ["Cover left now", inrExact(c.policy.remaining_inr)],
    ["Policy started", date(c.policy.inception_date)],
    ["This policy year", `${date(c.policy.period_start)} – ${date(c.policy.period_end)}`],
    ["Age at admission", c.draft ? `${c.draft.age}` : "—"],
    ["Paid to", `${c.payee.name ?? "—"} · ${c.payee.account}`],
    ["Policy status", c.policy.status],
  ];
  return (
    <Card title="Policy facts used">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-ink3">{k}</dt><dd className="text-sm font-medium capitalize-first">{v}</dd></div>
        ))}
      </dl>
    </Card>
  );
}

function Concerns({ c }: { c: ClaimDetail }) {
  const d = c.draft!;
  const lowConf = d.review_reasons.some((r) => r.startsWith("LOW_CONFIDENCE") || r.startsWith("Unclassified"));
  return (
    <Card title="Why a person needs to look">
      <ul className="space-y-3">
        {d.flags.map((f) => (
          <motion.li key={f} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-serious/15 text-[rgb(168_72_34)] dark:text-serious"><AlertTriangle size={15} /></span>
            <div><div className="text-sm font-medium">{FLAG[f]?.title ?? f}</div><div className="text-sm text-ink2">{FLAG[f]?.body}</div></div>
          </motion.li>
        ))}
        {lowConf && (
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink2"><Info size={15} /></span>
            <div><div className="text-sm font-medium">Reader wasn't fully sure</div><div className="text-sm text-ink2">Part of a document was hard to read or label. Please check the lines.</div></div>
          </li>
        )}
      </ul>
    </Card>
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
    const last = c.approvals[c.approvals.length - 1];
    return last ? (
      <Card title="Decision">
        <div className="space-y-2">
          {c.approvals.map((a) => (
            <div key={a.step} className="flex items-start gap-2 text-sm">
              <Check size={16} className="mt-0.5 text-good" />
              <div><b>{a.name}</b> {a.action === "approve" ? "approved" : a.action === "edit" ? "changed the amount to" : "rejected"}{a.amount && a.action !== "reject" ? ` ${inrExact(a.amount)}` : ""}
                {a.reason && <div className="text-ink2">“{a.reason}”</div>}
                <div className="text-xs text-ink3">{date(a.at)} {time(a.at)}</div></div>
            </div>
          ))}
        </div>
      </Card>
    ) : null;
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
    <Card className="border-brand/40 lg:sticky lg:top-20" title={mine ? "Your decision" : "Waiting for a decision"}>
      <div className="mb-4 rounded-xl bg-sunken p-4">
        <div className="text-xs text-ink3">{proposeReject ? "The agent proposes" : "The agent worked out"}</div>
        <div className="mt-0.5 text-2xl font-semibold tracking-tight tabular">
          {proposeReject ? "Not payable" : inrExact(d.payable_inr)}
        </div>
        <div className="text-sm text-ink2">{proposeReject ? REJECT[d.reject_code ?? ""] ?? d.reject_code : `of ${inrExact(d.claimed_inr)} claimed`}</div>
      </div>
      {!mine ? (
        <p className="flex items-center gap-2 text-sm text-ink2"><Lock size={15} /> Waiting for a {ROLE[c.waiting_for as keyof typeof ROLE]?.toLowerCase()}. You are signed in as {ROLE[user.role].toLowerCase()}.</p>
      ) : (
        <div className="space-y-2">
          {!proposeReject && (
            <motion.button whileTap={{ scale: 0.98 }} disabled={sending} onClick={() => send("approve")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 font-medium text-white disabled:opacity-60">
              <Check size={17} /> Approve {inrExact(d.payable_inr)}
            </motion.button>
          )}
          <div className={`grid gap-2 ${user.role === "claims_processor" ? "grid-cols-2" : "grid-cols-1"}`}>
            <button onClick={() => setMode(mode === "edit" ? "none" : "edit")} className={`rounded-xl border px-3 py-2 text-sm font-medium ${mode === "edit" ? "border-brand text-brand" : "border-line"}`}>
              {proposeReject ? "Pay an amount instead" : "Change amount"}
            </button>
            {user.role === "claims_processor" && (
              <button onClick={() => { setMode(mode === "reject" ? "none" : "reject"); if (proposeReject && !reason) setReason(REJECT[d.reject_code ?? ""] ?? ""); }}
                className={`rounded-xl border px-3 py-2 text-sm font-medium ${mode === "reject" ? "border-crit text-crit" : "border-line"}`}>
                {proposeReject ? "Confirm rejection" : "Reject"}
              </button>
            )}
          </div>
          <AnimatePresence>
            {mode !== "none" && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="space-y-2 pt-2">
                  {mode === "edit" && (
                    <label className="block text-sm">New amount (₹)
                      <input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 tabular outline-none focus:border-brand" />
                    </label>
                  )}
                  <label className="block text-sm">Reason (the member sees this in the letter)
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 outline-none focus:border-brand" />
                  </label>
                  <button disabled={sending || !reason.trim() || (mode === "edit" && !amount)} onClick={() => send(mode)}
                    className={`w-full rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${mode === "reject" ? "bg-crit" : "bg-brand"}`}>
                    {mode === "reject" ? "Reject claim" : "Save new amount"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {err && <p className="text-sm text-crit">{err}</p>}
          <p className="pt-1 text-xs text-ink3">Your decision is saved as an approval record. The payment step checks it again before any money moves.</p>
        </div>
      )}
    </Card>
  );
}

function DocsWaiting({ c, onDone }: { c: ClaimDetail; onDone: () => void }) {
  const asked = c.emails.filter((e) => e.kind === "docs_request");
  const [sending, setSending] = useState(false);
  return (
    <Card title="Waiting for the member">
      <ul className="space-y-2">
        {asked.map((e) => (
          <li key={e.idempotency_key} className="flex items-start gap-2 text-sm">
            <Mail size={16} className="mt-0.5 text-brand" />
            <div>We asked for the <b>{DOC_LABEL[e.doc_type ?? ""] ?? e.doc_type}</b><div className="text-xs text-ink3">{date(e.sent_at)} {time(e.sent_at)} · sent once, never repeated</div></div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink2">The claim is paused safely. It picks up where it stopped as soon as the document arrives, even days later.</p>
      <button disabled={sending} onClick={async () => { setSending(true); await api.deliverMissing(c.claim_id); setSending(false); onDone(); }}
        className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:border-brand hover:text-brand disabled:opacity-50">
        <Upload size={15} /> Demo: member uploads it
      </button>
    </Card>
  );
}

function Payment({ c }: { c: ClaimDetail }) {
  const p = c.payments[0];
  const retried = c.timeline.filter((e) => e.event === "payout_unclear").length;
  const adopted = c.timeline.some((e) => e.event === "payout_adopted");
  const status = c.payment_status?.status;
  if (!p && !status) return null;
  return (
    <Card title="Payment">
      {p ? (
        <div className="flex items-center gap-3">
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-good text-white"><Check size={22} /></motion.span>
          <div>
            <div className="text-lg font-semibold tabular">{inrExact(p.amount_inr)} paid</div>
            <div className="text-xs text-ink3">Ref {p.payment_id} · {date(p.created_at)} {time(p.created_at)}</div>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink2"><Loader2 size={15} className="animate-spin" /> {status === "payout_stuck" ? "Payment service not answering — a person can retry safely." : status === "payout_blocked_balance" ? "Not enough cover left — sent back to a processor." : "Paying…"}</p>
      )}
      {(retried > 0 || adopted) && (
        <div className="mt-4 rounded-xl bg-brandsoft p-3 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-brand"><ShieldCheck size={15} /> Safety net worked</div>
          <p className="mt-1 text-ink2">
            The payment service didn't confirm{retried > 1 ? ` ${retried} times` : ""}. Before trying again we checked whether the money had gone out.
            {adopted ? " It had — so we recorded that payment and did not pay a second time." : " It hadn't, so we tried again."}
          </p>
        </div>
      )}
      {p && <p className="mt-3 text-xs text-ink3">Payments to this claim: <b className="text-ink">{c.payments.length}</b></p>}
    </Card>
  );
}

function Letter({ body, template }: { body: string; template: boolean }) {
  return (
    <Card title="Settlement letter sent to the member" action={<span className="text-xs text-ink3">{template ? "Standard template" : "Drafted, numbers checked"}</span>}>
      <motion.pre initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-6 font-sans text-[14px] leading-relaxed text-ink shadow-inner">
        {body}
      </motion.pre>
    </Card>
  );
}
