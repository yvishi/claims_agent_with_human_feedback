import { motion } from "framer-motion";
import { AlertTriangle, Banknote, Calculator, CheckCircle2, FileSearch, Mail, RefreshCcw, ScanText, ShieldCheck, UserCheck, type LucideIcon } from "lucide-react";
import type { TimelineEvent } from "../api";
import { DOC_LABEL, inrExact, time } from "../words";

/** The audit trail, told as a story. Internal state changes are left out; real events stay. */
function describe(e: TimelineEvent): { icon: LucideIcon; text: string; tone?: "warn" | "good" } | null {
  const r = e.result ?? {};
  switch (e.event) {
    case "claim_loaded": return { icon: FileSearch, text: "Claim form received" };
    case "docs_checked": return r.missing?.length
      ? { icon: FileSearch, text: `Checked documents — missing: ${r.missing.map((m: string) => DOC_LABEL[m] ?? m).join(", ")}`, tone: "warn" }
      : { icon: FileSearch, text: `Checked documents — all ${r.files?.length ?? ""} present` };
    case "docs_requested": return { icon: Mail, text: "Emailed the member asking for the missing document" };
    case "bills_read": {
      const scans = Object.values(r.reads ?? {}).filter((x: any) => x.mode === "ocr").length;
      return { icon: ScanText, text: `Read ${r.lines} bill lines${scans ? ` (${scans} scanned page${scans > 1 ? "s" : ""} read on our computers)` : ""}; personal details hidden` };
    }
    case "policy_checked": return { icon: ShieldCheck, text: `Checked the policy: ${r.status}, ${inrExact(r.remaining)} cover left${r.duplicates?.length ? "; this bill was seen before" : ""}` };
    case "draft": return { icon: Calculator, text: r.decision === "reject" ? "Proposed: not payable — sent to a person" : `Worked out ${inrExact(r.payable_inr)} payable${r.route === "auto" ? " — small and clear, approved automatically" : " — sent to a person"}` };
    case "approval": {
      const who = e.actor === "system:auto" ? "Harborline system" : e.actor;
      const verb = r.action === "approve" ? "approved" : r.action === "edit" ? `changed the amount to ${inrExact(r.amount)}` : "rejected the claim";
      return { icon: UserCheck, text: `${who} ${verb}${r.action === "approve" && r.amount ? ` ${inrExact(r.amount)}` : ""}${r.reason && r.action !== "approve" ? ` — “${r.reason}”` : ""}`, tone: "good" };
    }
    case "payout_unclear": return { icon: RefreshCcw, text: "Payment service didn't confirm — checking before trying again", tone: "warn" };
    case "payout_adopted": return { icon: ShieldCheck, text: "Found the payment had already gone through — did not pay twice", tone: "good" };
    case "payout_paid": return { icon: Banknote, text: `Paid ${inrExact(r.amount_inr)} (ref ${r.payment_id})`, tone: "good" };
    case "payout_refused": return { icon: AlertTriangle, text: "Payment refused: no matching approval on record", tone: "warn" };
    case "payout_blocked_balance": return { icon: AlertTriangle, text: "Payment held: not enough cover left", tone: "warn" };
    case "letter_sent": return { icon: Mail, text: "Settlement letter sent to the member" };
    case "state": return e.state === "CLOSED" ? { icon: CheckCircle2, text: "Claim closed", tone: "good" } : null;
    case "error": return { icon: AlertTriangle, text: "Something went wrong — the claim will pick up from its last safe point", tone: "warn" };
    default: return null;
  }
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const items = events.map((e) => ({ e, d: describe(e) })).filter((x) => x.d) as { e: TimelineEvent; d: NonNullable<ReturnType<typeof describe>> }[];
  if (!items.length) return <p className="text-sm text-ink3">Nothing yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-line pl-5">
      {items.map(({ e, d }, i) => (
        <motion.li key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }} className="relative">
          <span className={`absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-raised
            ${d.tone === "good" ? "bg-good text-white" : d.tone === "warn" ? "bg-warn text-ink" : "bg-sunken text-ink2"}`}>
            <d.icon size={11} />
          </span>
          <div className="text-sm leading-snug">{d.text}</div>
          <div className="text-[11px] text-ink3">{time(e.at)}{e.model ? ` · AI helper used: ${e.prompt_version}` : ""}</div>
        </motion.li>
      ))}
    </ol>
  );
}
