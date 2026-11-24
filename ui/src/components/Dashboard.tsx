import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, Hourglass, Inbox, ListChecks, Mail, Wallet } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ClaimRow, type User } from "../api";
import { FLAG, ROLE, STAGES, inr, stageIndex } from "../words";
import { BarList, ColumnChart, DataTable, SegmentedBar, TableToggle, type Datum } from "./charts";
import { EASE, FloatingWindow, Pill, usePoll } from "./bits";

const num = (x: string | null | undefined) => (x ? Number(x) || 0 : 0);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Short money for tiles: ₹8,450 · ₹3.4 L · ₹1.2 Cr */
function inrShort(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
  return inr(Math.round(n));
}

const STEP_LABELS = ["New", ...STAGES.slice(1).map((s) => s.label), "Done"];

/** Claims per week (or per month when the history is long), oldest first, empty periods included. */
function filedSeries(claims: ClaimRow[]): { data: Datum[]; per: "week" | "month" } {
  const dates = claims.map((c) => new Date(c.filed_on)).filter((d) => !isNaN(+d));
  if (!dates.length) return { data: [], per: "week" };
  const min = new Date(Math.min(...dates.map(Number)));
  const max = new Date(Math.max(...dates.map(Number)));
  const weekStart = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const weeks = Math.round((+weekStart(max) - +weekStart(min)) / (7 * 864e5)) + 1;
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-IN", o);
  if (weeks <= 16) {
    const start = weekStart(min);
    const data: Datum[] = Array.from({ length: weeks }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i * 7);
      const end = new Date(d); end.setDate(end.getDate() + 6);
      return { label: fmt(d, { day: "numeric", month: "short" }), value: 0, hint: `Week of ${fmt(d, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short" })}` };
    });
    dates.forEach((d) => { data[Math.round((+weekStart(d) - +start) / (7 * 864e5))].value++; });
    return { data, per: "week" };
  }
  const months = (max.getFullYear() - min.getFullYear()) * 12 + max.getMonth() - min.getMonth() + 1;
  const data: Datum[] = Array.from({ length: months }, (_, i) => {
    const d = new Date(min.getFullYear(), min.getMonth() + i, 1);
    return { label: fmt(d, { month: "short" }), value: 0, hint: fmt(d, { month: "long", year: "numeric" }) };
  });
  dates.forEach((d) => { data[(d.getFullYear() - min.getFullYear()) * 12 + d.getMonth() - min.getMonth()].value++; });
  return { data, per: "month" };
}

function useDashboard(claims: ClaimRow[], user: User) {
  return useMemo(() => {
    const queue = claims
      .filter((c) => c.waiting_for === user.role && !c.busy)
      .sort((a, b) => +new Date(a.filed_on) - +new Date(b.filed_on));
    const done = claims.filter((c) => c.state === "CLOSED");
    const onMember = claims.filter((c) => c.waiting_for === "member" && c.state !== "CLOSED");
    const inProgress = claims.length - done.length - queue.length - onMember.length;

    const steps = STEP_LABELS.map((label) => ({ label, value: 0 }));
    claims.forEach((c) => {
      const i = stageIndex(c.state);
      steps[i < 0 ? 2 : i].value++; // an unknown state is still being assessed
    });

    const settled = claims.filter((c) => c.paid_inr !== null);
    const claimed = settled.reduce((s, c) => s + num(c.claimed_inr), 0);
    const paid = settled.reduce((s, c) => s + num(c.paid_inr), 0);
    const deducted = Math.max(0, claimed - paid);
    const approvedNotPaid = claims.filter((c) => c.paid_inr === null && c.payable_inr !== null && c.state !== "CLOSED"
      && (c.state === "AUTO_APPROVED" || c.state === "PAYOUT" || c.state === "LETTER"));
    const pending = approvedNotPaid.reduce((s, c) => s + num(c.payable_inr), 0);

    const open = claims.filter((c) => c.state !== "CLOSED");
    const flagCounts = new Map<string, number>();
    open.forEach((c) => c.flags.forEach((f) => flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1)));
    const flags: Datum[] = [...flagCounts.entries()]
      .map(([code, value]) => ({ label: FLAG[code]?.title ?? "Other check", value }))
      .reduce<Datum[]>((acc, d) => { const x = acc.find((a) => a.label === d.label); if (x) x.value += d.value; else acc.push(d); return acc; }, [])
      .sort((a, b) => b.value - a.value);

    return { queue, done, onMember, inProgress: Math.max(0, inProgress), steps, settled, claimed, paid, deducted, pending, approvedNotPaid, flags, filed: filedSeries(claims) };
  }, [claims, user.role]);
}

export function Dashboard({ user }: { user: User }) {
  const { data, error } = usePoll(api.claims, 4000);
  const canvas = useRef<HTMLDivElement>(null);
  const first = user.name.split(/\s+/)[0];
  const d = useDashboard(data ?? [], user);
  const [tables, setTables] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => <TableToggle on={!!tables[k]} onChange={(v) => setTables((t) => ({ ...t, [k]: v }))} />;

  const loading = data === null && !error;
  const n = d.queue.length;
  const sentence = loading ? "Getting your claims ready…"
    : n > 0 ? `${plural(n, "claim")} ${n === 1 ? "needs" : "need"} your decision.`
    : "You're all caught up. Nothing is waiting for you.";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{ROLE[user.role]}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{greeting()}, {first}</h1>
          <p className="mt-1 text-[15px] text-ink2">{sentence}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {n > 0 && (
            <Link to={`/claims/${d.queue[0].claim_id}`} className="btn-primary">
              Open next claim <ArrowRight size={16} aria-hidden />
            </Link>
          )}
          <Link to="/claims" className={n > 0 ? "btn-ghost" : "btn-primary"}>
            See all claims {n === 0 && <ArrowRight size={16} aria-hidden />}
          </Link>
        </div>
      </motion.section>

      {error && (
        <div role="alert" className="glass flex items-center gap-3 px-4 py-3 text-sm text-ink">
          <AlertTriangle size={18} className="shrink-0 text-crit" aria-hidden />
          We couldn't load your dashboard. Retrying…
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Needs you" value={n} icon={<Inbox size={16} />} delay={0.05} accent loading={loading}
          note={n ? "Waiting for your decision" : "Nothing waiting"} />
        <Tile label="In progress" value={d.inProgress} icon={<Hourglass size={16} />} delay={0.1} loading={loading}
          note="Moving through the steps" />
        <Tile label="Waiting on members" value={d.onMember.length} icon={<Mail size={16} />} delay={0.15} loading={loading}
          note="Asked for documents" />
        <Tile label="Completed" value={d.done.length} icon={<CheckCircle2 size={16} />} delay={0.2} loading={loading}
          note="Closed claims" />
      </div>

      {/* Canvas of floating windows */}
      <div ref={canvas} className={`relative grid grid-cols-1 gap-5 transition-opacity lg:grid-cols-12 ${error && data ? "opacity-70" : ""}`}>
        <FloatingWindow title="Your queue" icon={<ListChecks size={15} />} bounds={canvas} delay={0.15} className="lg:col-span-7"
          action={n > 5 ? <Link to="/claims" className="text-xs font-semibold text-brand hover:underline">See all {n}</Link> : undefined}>
          {loading ? <Skeleton rows={4} /> : <Queue rows={d.queue.slice(0, 5)} />}
        </FloatingWindow>

        <FloatingWindow title="Money" icon={<Wallet size={15} />} bounds={canvas} delay={0.22} className="lg:col-span-5 lg:mt-8" action={toggle("money")}>
          {loading ? <Skeleton rows={3} /> : d.settled.length === 0 ? (
            <Empty icon={<Wallet size={18} />} text="No claims have been paid yet." />
          ) : tables.money ? (
            <DataTable caption="Money on paid claims" head={["", "Amount"]} rows={[
              ["Claimed", inr(d.claimed)], ["Paid to members", inr(d.paid)], ["Deducted", inr(d.deducted)],
              ...(d.pending > 0 ? [["Approved, payment on the way", inr(d.pending)] as [string, string]] : []),
            ]} />
          ) : (
            <div>
              <p className="eyebrow">Paid to members</p>
              <p className="mt-1 text-5xl font-semibold tracking-tight text-ink">{inrShort(d.paid)}</p>
              <p className="mt-1 text-sm text-ink2">
                of {inr(d.claimed)} claimed on {plural(d.settled.length, "paid claim")}
              </p>
              <div className="mt-5">
                <SegmentedBar title="Paid compared with deducted" parts={[
                  { label: "Paid", value: d.paid, color: "rgb(var(--paid))", display: inr(d.paid) },
                  { label: "Deducted", value: d.deducted, color: "rgb(var(--deduct))", display: inr(d.deducted) },
                ]} />
              </div>
              {d.pending > 0 && (
                <p className="well mt-4 px-3 py-2 text-xs text-ink2">
                  <span className="font-semibold text-ink">{inr(d.pending)}</span> more is approved and on its way
                  ({plural(d.approvedNotPaid.length, "claim")}).
                </p>
              )}
            </div>
          )}
        </FloatingWindow>

        <FloatingWindow title="Where claims are" icon={<BarChart3 size={15} />} bounds={canvas} delay={0.3} className="lg:col-span-7" action={toggle("steps")}>
          {loading ? <Skeleton rows={3} /> : !data?.length ? <Empty icon={<Inbox size={18} />} text="No claims yet." /> : tables.steps ? (
            <DataTable caption="Claims at each step" head={["Step", "Claims"]} rows={d.steps.map((s) => [s.label, String(s.value)])} />
          ) : (
            <>
              <p className="mb-2 text-xs text-ink3">Number of claims at each step, from new to done</p>
              <ColumnChart title="Claims at each step" data={d.steps} />
            </>
          )}
        </FloatingWindow>

        <FloatingWindow title="Needs attention" icon={<AlertTriangle size={15} />} bounds={canvas} delay={0.38} className="lg:col-span-5 lg:-mt-2" action={d.flags.length ? toggle("flags") : undefined}>
          {loading ? <Skeleton rows={3} /> : d.flags.length === 0 ? (
            <Empty icon={<CheckCircle2 size={18} />} text="No open claims have warnings." />
          ) : tables.flags ? (
            <DataTable caption="Warnings on open claims" head={["Warning", "Claims"]} rows={d.flags.map((f) => [f.label, String(f.value)])} />
          ) : (
            <>
              <p className="mb-2 text-xs text-ink3">Open claims with something to check</p>
              <BarList title="Warnings on open claims" data={d.flags} />
            </>
          )}
        </FloatingWindow>

        <FloatingWindow title="Claims filed" icon={<CalendarDays size={15} />} bounds={canvas} delay={0.46} className="lg:col-span-12" action={toggle("filed")}>
          {loading ? <Skeleton rows={3} /> : d.filed.data.length === 0 ? <Empty icon={<CalendarDays size={18} />} text="No claims filed yet." /> : tables.filed ? (
            <DataTable caption={`Claims filed per ${d.filed.per}`} head={[d.filed.per === "week" ? "Week of" : "Month", "Claims"]}
              rows={d.filed.data.map((x) => [d.filed.per === "week" ? x.label : x.hint ?? x.label, String(x.value)])} />
          ) : (
            <>
              <p className="mb-2 text-xs text-ink3">New claims each {d.filed.per}, by the date they were filed</p>
              <ColumnChart title={`Claims filed per ${d.filed.per}`} data={d.filed.data} height={180} />
            </>
          )}
        </FloatingWindow>
      </div>
    </div>
  );
}

function Tile({ label, value, icon, note, delay, accent, loading }: {
  label: string; value: number; icon: React.ReactNode; note: string; delay: number; accent?: boolean; loading?: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE, delay }}
      className={`glass min-w-0 p-4 sm:p-5 ${accent && value > 0 ? "ring-2 ring-inset ring-brand/30" : ""}`}>
      <div className="flex items-center gap-2 text-ink2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${accent && value > 0 ? "bg-brand text-onbrand" : "bg-brand/10 text-brand"}`} aria-hidden>{icon}</span>
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {loading ? <span className="inline-block h-9 w-12 animate-pulse rounded-lg bg-ink3/15" /> : value.toLocaleString("en-IN")}
      </div>
      <p className="mt-1 truncate text-xs text-ink3">{note}</p>
    </motion.div>
  );
}

function Queue({ rows }: { rows: ClaimRow[] }) {
  if (!rows.length) return <Empty icon={<CheckCircle2 size={18} />} text="You're all caught up" sub="New claims for you will appear here." />;
  return (
    <ul className="-mx-2 divide-y divide-line/60">
      {rows.map((c) => (
        <li key={c.claim_id}>
          <Link to={`/claims/${c.claim_id}`}
            className="group flex items-center gap-3 rounded-2xl px-2 py-2.5 outline-none transition-colors hover:bg-ink3/5 focus-visible:ring-2 focus-visible:ring-brand">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{c.member_name}</div>
              <div className="truncate text-xs text-ink3">{c.hospital_name}</div>
              <div className="mt-1 sm:hidden"><Pill tone="warn">Needs your decision</Pill></div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-sm font-semibold text-ink tabular">{inr(c.claimed_inr)}</span>
              <span className="hidden sm:inline-flex"><Pill tone="warn">Needs your decision</Pill></span>
            </div>
            <ArrowRight size={16} className="shrink-0 text-ink3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Empty({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string }) {
  return (
    <div className="well flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-good/10 text-good" aria-hidden>{icon}</span>
      <p className="text-sm font-semibold text-ink">{text}</p>
      {sub && <p className="text-xs text-ink3">{sub}</p>}
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 py-1" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-xl bg-ink3/10" style={{ width: `${92 - i * 12}%` }} />
      ))}
    </div>
  );
}
