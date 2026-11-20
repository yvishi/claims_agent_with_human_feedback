import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ArrowRight, Hospital, Play, PlayCircle, RotateCcw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ClaimRow, type User } from "../api";
import { FLAG, LANES, inr, inrExact, statusLine, tone } from "../words";
import { Avatar, Card, CountUp, FlagChip, Pill, usePoll } from "./bits";

type Filter = "all" | "mine" | "working" | "done" | "new";

export function Desk({ user }: { user: User }) {
  const { data, refresh } = usePoll(api.claims, 1500);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const claims = data ?? [];
  const mine = (c: ClaimRow) => c.waiting_for === user.role;

  const stats = useMemo(() => {
    const decided = claims.filter((c) => c.payable_inr !== null && c.draft_decision !== "reject");
    return {
      total: claims.length,
      mine: claims.filter(mine).length,
      paid: claims.reduce((s, c) => s + Number(c.paid_inr ?? 0), 0),
      saved: decided.reduce((s, c) => s + (Number(c.claimed_inr) - Number(c.payable_inr)), 0),
      done: claims.filter((c) => c.state === "CLOSED").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claims, user.role]);

  const shown = claims.filter((c) =>
    filter === "all" ? true : filter === "mine" ? mine(c) : filter === "done" ? c.state === "CLOSED"
      : filter === "new" ? c.state === "NOT_STARTED" : !["CLOSED", "NOT_STARTED"].includes(c.state));

  const startMany = async (ids: string[]) => {
    setBusy(true);
    for (const id of ids) await api.start(id);
    setBusy(false);
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-ink2">
            {stats.mine > 0 ? <>You have <b className="text-ink">{stats.mine}</b> claim{stats.mine > 1 ? "s" : ""} waiting for your decision.</>
              : "Nothing is waiting for you right now."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => startMany(claims.filter((c) => c.state === "NOT_STARTED").slice(0, 6).map((c) => c.claim_id))}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-card hover:opacity-90 disabled:opacity-50">
            <PlayCircle size={16} /> Run next 6 claims
          </button>
          <button disabled={busy} onClick={async () => { if (confirm("Clear every run and start the demo again?")) { await api.reset(); refresh(); } }}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-sm text-ink2 hover:text-ink">
            <RotateCcw size={15} /> Reset demo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Claims on the desk" value={stats.total} fmt={(n) => Math.round(n).toString()} sub={`${stats.done} finished`} />
        <Stat label="Waiting for you" value={stats.mine} fmt={(n) => Math.round(n).toString()} sub={user.role === "medical_reviewer" ? "Over ₹1,00,000" : "Approve, adjust or reject"} accent />
        <Stat label="Paid to members" value={stats.paid} fmt={(n) => inr(n)} sub="Each paid exactly once" />
        <Stat label="Deducted by policy rules" value={stats.saved} fmt={(n) => inr(n)} sub="Every rupee explained" />
      </div>

      <Board claims={claims} />

      <Card title="Claims" action={
        <div className="flex flex-wrap gap-1 rounded-xl bg-sunken p-1">
          {([["all", "All"], ["mine", "Waiting for me"], ["working", "In progress"], ["done", "Done"], ["new", "Not started"]] as [Filter, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`relative rounded-lg px-3 py-1 text-xs font-medium ${filter === k ? "text-ink" : "text-ink2 hover:text-ink"}`}>
              {filter === k && <motion.span layoutId="filter-bg" className="absolute inset-0 rounded-lg bg-raised shadow-card" />}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      }>
        <motion.ul layout className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {shown.map((c) => <ClaimLine key={c.claim_id} c={c} mine={mine(c)} onStart={() => startMany([c.claim_id])} />)}
          </AnimatePresence>
          {shown.length === 0 && <li className="py-10 text-center text-sm text-ink3">No claims here.</li>}
        </motion.ul>
      </Card>
    </div>
  );
}

function Stat({ label, value, fmt, sub, accent }: { label: string; value: number; fmt: (n: number) => string; sub: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-brand/40" : ""}>
      <div className="text-xs font-medium uppercase tracking-wide text-ink3">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tracking-tight ${accent ? "text-brand" : ""}`}><CountUp value={value} format={fmt} /></div>
      <div className="mt-1 text-xs text-ink2">{sub}</div>
    </Card>
  );
}

/** The live board: each claim is a dot that glides to the next lane as the agent works. */
function Board({ claims }: { claims: ClaimRow[] }) {
  const nav = useNavigate();
  return (
    <Card title="Where every claim is right now" action={<span className="flex items-center gap-1.5 text-xs text-ink3"><Sparkles size={13} /> Updates live</span>}>
      <LayoutGroup>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LANES.map((lane, i) => {
            const inLane = claims.filter((c) => lane.states.includes(c.state));
            const MAX = 14;
            return (
              <div key={lane.key} className="flex min-h-[132px] flex-col rounded-xl bg-sunken/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-ink2">{i + 1}. {lane.label}</span>
                  <motion.span key={inLane.length} initial={{ scale: 1.4 }} animate={{ scale: 1 }}
                    className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold tabular">{inLane.length}</motion.span>
                </div>
                <div className="flex flex-wrap content-start gap-1.5">
                  {inLane.slice(0, MAX).map((c) => (
                    <motion.button layout layoutId={`dot-${c.claim_id}`} key={c.claim_id}
                      transition={{ type: "spring", stiffness: 260, damping: 26 }}
                      onClick={() => nav(`/claims/${c.claim_id}`)}
                      title={`${c.case ?? c.claim_id} · ${c.member_name} · ${statusLine(c)}`}
                      className={`flex h-7 items-center rounded-full px-2 text-[11px] font-semibold tabular shadow-card ring-1 ring-inset
                        ${c.waiting_for && c.waiting_for !== "member" ? "bg-warn/20 ring-warn/60" : c.state === "WAITING_FOR_DOCS" ? "bg-serious/15 ring-serious/50"
                          : c.state === "CLOSED" ? (c.paid_inr ? "bg-good/10 ring-good/40" : "bg-crit/10 ring-crit/40") : "bg-raised ring-line"}`}>
                      {c.case ?? c.claim_id.slice(-4)}
                    </motion.button>
                  ))}
                  {inLane.length > MAX && <span className="px-1 text-xs text-ink3">+{inLane.length - MAX}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink3">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />Waiting for a person</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-serious" />Waiting for the member</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-good" />Paid</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-crit" />Not paid</span>
      </div>
    </Card>
  );
}

function ClaimLine({ c, mine, onStart }: { c: ClaimRow; mine: boolean; onStart: () => void }) {
  const nav = useNavigate();
  const deducted = c.payable_inr !== null && Number(c.payable_inr) < Number(c.claimed_inr) && c.draft_decision !== "reject";
  return (
    <motion.li layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <Avatar name={c.member_name} size={36} />
      <div className="min-w-[180px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{c.member_name}</span>
          {c.case && <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] font-semibold text-ink2">{c.case}</span>}
          {c.flags.map((f) => <FlagChip key={f} title={FLAG[f]?.title ?? f} />)}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-ink3"><Hospital size={12} /> {c.hospital_name}{c.scenario && <> · {c.scenario}</>}</div>
      </div>
      <div className="w-36 text-right tabular">
        <div className="text-sm">{inrExact(c.claimed_inr)} <span className="text-ink3">claimed</span></div>
        {c.payable_inr !== null && (
          <div className={`text-xs ${deducted ? "text-[rgb(var(--deduct))]" : "text-ink2"}`}>
            {c.draft_decision === "reject" ? "Proposed: reject" : <>{inrExact(c.payable_inr)} payable</>}
          </div>
        )}
      </div>
      <div className="w-64"><Pill tone={tone(c)} spin={c.busy}>{statusLine(c)}</Pill></div>
      {c.state === "NOT_STARTED" ? (
        <button onClick={onStart} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-brand hover:text-brand">
          <Play size={14} /> Start
        </button>
      ) : (
        <button onClick={() => nav(`/claims/${c.claim_id}`)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${mine ? "bg-brand text-white" : "border border-line hover:border-brand hover:text-brand"}`}>
          {mine ? "Review" : "Open"} <ArrowRight size={14} />
        </button>
      )}
    </motion.li>
  );
}

