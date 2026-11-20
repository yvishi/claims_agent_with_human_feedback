// Every internal code is translated here into words a member or a client would use.
import {
  Banknote, Calculator, CheckCircle2, FileSearch, Inbox, Mail, ScanText, ShieldCheck, UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { ClaimRow } from "./api";

export const inr = (x: string | number | null | undefined, paise = false) => {
  if (x === null || x === undefined || x === "") return "—";
  const n = typeof x === "number" ? x : Number(x);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: paise ? 2 : 0 });
};
export const inrExact = (x: string | number | null | undefined) => {
  const n = Number(x ?? 0);
  return Number.isInteger(n) ? inr(n) : inr(n, true);
};

export const date = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const time = (s?: string | null) =>
  s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

export type Stage = { key: string; label: string; detail: string; icon: LucideIcon; states: string[] };
export const STAGES: Stage[] = [
  { key: "received", label: "Received", detail: "Claim form arrives", icon: Inbox, states: ["RECEIVED"] },
  { key: "documents", label: "Documents", detail: "Checklist: bill, receipt, discharge summary", icon: FileSearch, states: ["DOCS_CHECK", "WAITING_FOR_DOCS"] },
  { key: "reading", label: "Reading bills", detail: "Read on our computers, personal details hidden", icon: ScanText, states: ["READ_BILLS"] },
  { key: "policy", label: "Policy check", detail: "Active? Waiting period? Money left?", icon: ShieldCheck, states: ["POLICY_CHECK"] },
  { key: "deciding", label: "Working out", detail: "Policy rules applied, line by line", icon: Calculator, states: ["ADJUDICATE", "ROUTE"] },
  { key: "approval", label: "Approval", detail: "A person signs off when needed", icon: UserCheck, states: ["AUTO_APPROVED", "WAITING_FOR_PROCESSOR", "WAITING_FOR_PROCESSOR_AND_REVIEWER"] },
  { key: "payment", label: "Payment", detail: "Paid exactly once", icon: Banknote, states: ["PAYOUT"] },
  { key: "letter", label: "Letter", detail: "Every deduction explained", icon: Mail, states: ["LETTER"] },
  { key: "done", label: "Closed", detail: "Finished", icon: CheckCircle2, states: ["CLOSED"] },
];
export const stageIndex = (state: string) => STAGES.findIndex((s) => s.states.includes(state));

// Board lanes group the nine stages into six columns a client can follow at a glance.
export const LANES = [
  { key: "new", label: "Not started", states: ["NOT_STARTED"] },
  { key: "docs", label: "Checking documents", states: ["RECEIVED", "DOCS_CHECK", "WAITING_FOR_DOCS"] },
  { key: "work", label: "Reading & working out", states: ["READ_BILLS", "POLICY_CHECK", "ADJUDICATE", "ROUTE"] },
  { key: "people", label: "With a person", states: ["WAITING_FOR_PROCESSOR", "WAITING_FOR_PROCESSOR_AND_REVIEWER"] },
  { key: "paying", label: "Paying & writing", states: ["AUTO_APPROVED", "PAYOUT", "LETTER"] },
  { key: "done", label: "Done", states: ["CLOSED"] },
];

export const ROLE = { claims_processor: "Claims processor", medical_reviewer: "Medical reviewer" } as const;

export function statusLine(c: Pick<ClaimRow, "state" | "waiting_for" | "paid_inr" | "draft_decision">): string {
  switch (c.state) {
    case "NOT_STARTED": return "Not started";
    case "WAITING_FOR_DOCS": return "Waiting for the member to send a document";
    case "WAITING_FOR_PROCESSOR": return "Waiting for a claims processor";
    case "WAITING_FOR_PROCESSOR_AND_REVIEWER":
      return c.waiting_for === "medical_reviewer" ? "Waiting for the medical reviewer" : "Waiting for a claims processor (then the medical reviewer)";
    case "CLOSED": return c.paid_inr ? `Paid ${inrExact(c.paid_inr)}` : "Closed — not paid";
    case "PAYOUT": return "Paying the member";
    case "LETTER": return "Writing the settlement letter";
    case "AUTO_APPROVED": return "Approved automatically (small, no concerns)";
    default: {
      const s = STAGES[stageIndex(c.state)];
      return s ? `Working: ${s.label.toLowerCase()}` : c.state;
    }
  }
}

export type Tone = "good" | "warn" | "crit" | "brand" | "muted";
export function tone(c: Pick<ClaimRow, "state" | "paid_inr">): Tone {
  if (c.state === "CLOSED") return c.paid_inr ? "good" : "crit";
  if (c.state.startsWith("WAITING")) return "warn";
  if (c.state === "NOT_STARTED") return "muted";
  return "brand";
}

export const CATEGORY: Record<string, { label: string; hint: string }> = {
  room: { label: "Room", hint: "Ward or room rent per day" },
  icu: { label: "ICU", hint: "Intensive care bed per day" },
  nursing: { label: "Nursing", hint: "Nursing care" },
  doctor_fee: { label: "Doctor's fees", hint: "Consultant and doctor visits" },
  procedure: { label: "Surgery & procedures", hint: "Operations, theatre, anaesthesia" },
  implants: { label: "Implants", hint: "Lens, stent, plates and screws" },
  diagnostics: { label: "Tests & scans", hint: "Lab tests, X-ray, imaging" },
  consumables: { label: "Medical supplies", hint: "Syringes, IV sets, dressings" },
  medicines: { label: "Medicines", hint: "Pharmacy items" },
  non_payable: { label: "Not covered", hint: "Personal or admin items the policy excludes" },
};

export const DEDUCTION: Record<string, string> = {
  NON_PAYABLE: "Items the policy doesn't cover",
  ROOM_RENT_PROPORTIONATE: "Room above the daily limit",
  SUB_LIMIT: "Limit for this treatment",
  CO_PAY: "Member's share (age 60+)",
  BALANCE_CAP: "Only this much cover was left",
};

export const FLAG: Record<string, { title: string; body: string }> = {
  WAITING_PERIOD: { title: "Waiting period", body: "The treatment falls inside a waiting period of the policy." },
  DUPLICATE: { title: "Possible duplicate", body: "This hospital bill seems to have been claimed before." },
  LATE_FILING: { title: "Filed late", body: "Filed more than 30 days after discharge. A person decides whether to accept it." },
  WATCHLIST_HOSPITAL: { title: "Hospital on watch list", body: "Claims from this hospital are always checked by a person." },
  DATE_MISMATCH: { title: "Dates don't match", body: "The bill and the discharge summary give different dates." },
  BILL_TOTAL_MISMATCH: { title: "Bill doesn't add up", body: "The bill's total differs from its lines. We worked from the lines." },
  INSTRUCTION_IN_DOCUMENT: { title: "Note on a document", body: "A document tried to tell us how to decide. It changes nothing; a person takes a look." },
};

export const REJECT: Record<string, string> = {
  POLICY_INACTIVE: "The policy wasn't active on the admission date",
  WAITING_PERIOD: "The treatment is inside a waiting period",
  DUPLICATE: "This bill was already claimed",
};

export const DOC_LABEL: Record<string, string> = {
  discharge_summary: "discharge summary", prescription: "prescription", receipt: "payment receipt", final_bill: "final hospital bill",
};
