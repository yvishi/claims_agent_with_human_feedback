import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Hospital, Inbox, Loader2, PlayCircle, Search, SearchX, WifiOff } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ClaimRow, type User } from "../api";
import { date, inrExact, statusLine, tone } from "../words";
import { Avatar, EASE, Pill, usePoll } from "./bits";

type Tab = "mine" | "progress" | "done" | "all";

export function Desk({ user }: { user: User }) {
  const reduce = useReducedMotion();
  const { data, error, refresh } = usePoll(api.claims, 3000);
  const [picked, setPicked] = useState<Tab | null>(null);
  const [q, setQ] = useState("");
  const [starting, setStarting] = useState(false);

  const claims = data ?? [];
  const isMine = (c: ClaimRow) => c.waiting_for === user.role && !c.busy;
  const groups: Record<Tab, ClaimRow[]> = {
    mine: claims.filter(isMine),
    progress: claims.filter((c) => c.state !== "CLOSED" && !isMine(c)),
    done: claims.filter((c) => c.state === "CLOSED"),
    all: claims,
  };
  const tab: Tab = picked ?? (groups.mine.length ? "mine" : "all");
  const needle = q.trim().toLowerCase();
  const shown = groups[tab].filter((c) => !needle
    || [c.member_name, c.hospital_name, c.claim_id].some((s) => s.toLowerCase().includes(needle)));
  const fresh = claims.filter((c) => c.state === "NOT_STARTED");

  const startNew = async () => {
    setStarting(true);
    try { for (const c of fresh) await api.start(c.claim_id); } finally { setStarting(false); refresh(); }
  };

  const tabs: [Tab, string][] = [["mine", "Needs your decision"], ["progress", "In progress"], ["done", "Completed"], ["all", "All"]];

  const empty = !data
    ? (error ? { Icon: WifiOff, text: "We couldn't load claims. Retrying…" } : { Icon: Loader2, text: "Loading claims…" })
    : needle ? { Icon: SearchX, text: "No claims match your search." }
    : { Icon: Inbox, text: tab === "mine" ? "Nothing needs your decision right now." : "No claims here." };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Claims</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Hello, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-ink2">
            {!data ? " " : groups.mine.length > 0
              ? <><b className="text-ink">{groups.mine.length}</b> claim{groups.mine.length > 1 ? "s need" : " needs"} your decision.</>
              : "You're all caught up."}
          </p>
        </div>
        {fresh.length > 0 && (
          <button disabled={starting} onClick={startNew} className="btn-primary">
            {starting ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
            {starting ? "Starting…" : `Process ${fresh.length} new claim${fresh.length > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      <motion.section
        initial={reduce ? false : { opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="glass overflow-hidden rounded-[28px]">
        <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
          <div role="tablist" aria-label="Filter claims" className="well flex max-w-full flex-wrap gap-0.5 rounded-[18px] p-1">
            {tabs.map(([k, label]) => {
              const on = tab === k;
              const hot = k === "mine" && groups.mine.length > 0;
              return (
                <button key={k} role="tab" aria-selected={on} onClick={() => setPicked(k)}
                  className={`relative inline-flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/50 ${on ? "text-ink" : "text-ink2 hover:text-ink"}`}>
                  {on && (
                    <motion.span layoutId="desk-tab" aria-hidden
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                      className="glass-strong absolute inset-0 rounded-[14px]"
                      style={{ boxShadow: "inset 0 1px 0 rgb(255 255 255 / var(--hi-a)), 0 4px 12px -4px rgb(var(--shadow) / 0.25)" }} />
                  )}
                  <span className="relative">{label}</span>
                  <span className={`relative min-w-[1.25rem] rounded-full px-1.5 text-center text-xs font-semibold tabular ${hot ? "bg-brand text-onbrand" : "bg-ink3/15 text-ink3"}`}>
                    {groups[k].length}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="relative ml-auto w-full sm:w-72">
            <span className="sr-only">Search claims</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, hospital or claim no."
              className="field rounded-full pl-9" />
          </label>
        </div>

        <ul className="space-y-1.5 px-2 pb-2 sm:px-3 sm:pb-3">
          <AnimatePresence initial={false}>
            {shown.map((c) => <ClaimLine key={c.claim_id} c={c} mine={isMine(c)} />)}
          </AnimatePresence>
          {shown.length === 0 && (
            <li className="well flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-ink3">
              <empty.Icon size={22} className={!data && !error ? "animate-spin" : ""} aria-hidden />
              {empty.text}
            </li>
          )}
        </ul>
      </motion.section>
    </div>
  );
}

function ClaimLine({ c, mine }: { c: ClaimRow; mine: boolean }) {
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const status = mine ? "Needs your decision" : statusLine(c);
  return (
    <motion.li layout={!reduce}
      initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}>
      <button onClick={() => nav(`/claims/${c.claim_id}`)}
        className={`group relative grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 overflow-hidden rounded-[18px] border px-4 py-3 text-left outline-none transition-all duration-200 hover:-translate-y-px hover:border-[rgb(var(--edge)/var(--edge-a))] hover:bg-[rgb(var(--glass)/0.75)] hover:shadow-card focus-visible:ring-2 focus-visible:ring-brand/50 motion-reduce:hover:translate-y-0 sm:grid-cols-[auto_minmax(0,1fr)_140px_210px_auto]
          ${mine ? "border-sky/40 bg-sky/10" : "border-transparent"}`}>
        {mine && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-sky to-brand shadow-[0_0_12px_rgb(var(--sky)/0.8)]" />}
        <Avatar name={c.member_name} size={38} />
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">{c.member_name}</div>
          <div className="flex min-w-0 items-center gap-1 text-xs text-ink3">
            <Hospital size={12} className="shrink-0" /> <span className="truncate">{c.hospital_name} · Filed {date(c.filed_on)}</span>
          </div>
        </div>
        <div className="text-right tabular sm:text-left">
          <div className="text-sm font-medium text-ink">{inrExact(c.claimed_inr)}</div>
          <div className="text-xs text-ink3">claimed</div>
        </div>
        <div className="col-span-3 sm:col-span-1">
          <Pill tone={mine ? "warn" : tone(c)} spin={c.busy}>{status}</Pill>
        </div>
        <ChevronRight size={16} className="hidden text-ink3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand sm:block" />
      </button>
    </motion.li>
  );
}
