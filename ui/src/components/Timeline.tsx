import { AlertTriangle, Banknote, Calculator, CheckCircle2, FileSearch, Mail, ShieldCheck, UserCheck, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { TimelineEvent } from "../api";
import { DOC_LABEL, date, inrExact, time } from "../words";
import { EASE } from "./bits";

/** The claim's history in plain words. Internal steps are left out. */
function describe(e: TimelineEvent): { icon: LucideIcon; text: string; tone?: "warn" | "good" } | null {
  const r = e.result ?? {};
  switch (e.event) {
    case "claim_loaded": return { icon: FileSearch, text: "Claim received" };
    case "docs_checked": return r.missing?.length
      ? { icon: FileSearch, text: `Documents checked. Missing: ${r.missing.map((m: string) => DOC_LABEL[m] ?? m).join(", ")}`, tone: "warn" }
      : { icon: FileSearch, text: "Documents checked, all received" };
    case "docs_requested": return { icon: Mail, text: "Asked the member for the missing document" };
    case "policy_checked": return { icon: ShieldCheck, text: "Policy checked" };
    case "draft": return { icon: Calculator, text: r.decision === "reject" ? "Assessed as not payable" : `Assessed: ${inrExact(r.payable_inr)} payable` };
    case "approval": {
      if (e.actor === "system:auto") return { icon: UserCheck, text: "Approved automatically", tone: "good" };
      const verb = r.action === "approve" ? "approved" : r.action === "edit" ? `approved a changed amount of ${inrExact(r.amount)}` : "rejected the claim";
      return { icon: UserCheck, text: `${e.actor} ${verb}`, tone: "good" };
    }
    case "payout_paid": return { icon: Banknote, text: `Paid ${inrExact(r.amount_inr)}`, tone: "good" };
    case "payout_blocked_balance": return { icon: AlertTriangle, text: "Payment on hold: not enough cover remaining", tone: "warn" };
    case "letter_sent": return { icon: Mail, text: "Letter sent to the member" };
    case "error": return { icon: AlertTriangle, text: "Processing paused by a temporary problem", tone: "warn" };
    case "state": return e.state === "CLOSED" ? { icon: CheckCircle2, text: "Claim closed", tone: "good" } : null;
    default: return null;
  }
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const reduce = useReducedMotion();
  const items = events.map((e) => ({ e, d: describe(e) })).filter((x) => x.d) as { e: TimelineEvent; d: NonNullable<ReturnType<typeof describe>> }[];
  if (!items.length) return <p className="text-sm text-ink3">Nothing yet.</p>;
  const last = items.length - 1;
  return (
    <ol className="relative">
      {/* the track: a soft beam that brightens towards the newest entry */}
      <span aria-hidden className="absolute bottom-3 left-[13px] top-3 w-[2px] rounded-full bg-gradient-to-b from-line via-line/80 to-brand/50" />
      {items.map(({ e, d }, i) => {
        const node = d.tone === "good" ? "bg-good/15 text-good ring-good/40 shadow-[0_0_14px_-2px_rgb(var(--good)/0.55)]"
          : d.tone === "warn" ? "bg-warn/20 text-[rgb(158_104_0)] dark:text-warn ring-warn/50 shadow-[0_0_14px_-2px_rgb(var(--warn)/0.6)]"
          : "bg-raised text-ink2 ring-line";
        const latest = i === last;
        return (
          <motion.li key={e.id} className="relative flex gap-3.5 pb-4 last:pb-0"
            initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: Math.min(i, 12) * 0.035 }}>
            <span className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${node}
              ${latest ? "outline outline-4 outline-brand/15" : ""}`}>
              <d.icon size={13} />
            </span>
            <div className={`min-w-0 flex-1 pt-0.5`}>
              <div className={`break-words text-sm leading-snug ${latest ? "font-semibold text-ink" : "text-ink"}`}>{d.text}</div>
              <div className="mt-0.5 text-[11px] text-ink3 tabular">{date(e.at)}, {time(e.at)}</div>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
