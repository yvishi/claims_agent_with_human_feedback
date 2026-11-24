// Every internal code is translated here into plain words for the people using the portal.
import { Banknote, Calculator, FileSearch, Inbox, UserCheck, type LucideIcon } from "lucide-react";
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
  s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

export type Stage = { key: string; label: string; icon: LucideIcon; states: string[] };
/** Five steps a reader can follow. CLOSED means every step is done. */
export const STAGES: Stage[] = [
  { key: "submitted", label: "Submitted", icon: Inbox, states: ["NOT_STARTED", "RECEIVED"] },
  { key: "documents", label: "Documents", icon: FileSearch, states: ["DOCS_CHECK", "WAITING_FOR_DOCS"] },
  { key: "assessment", label: "Assessment", icon: Calculator, states: ["READ_BILLS", "POLICY_CHECK", "ADJUDICATE", "ROUTE"] },
  { key: "approval", label: "Approval", icon: UserCheck, states: ["AUTO_APPROVED", "WAITING_FOR_PROCESSOR", "WAITING_FOR_PROCESSOR_AND_REVIEWER"] },
  { key: "payment", label: "Payment", icon: Banknote, states: ["PAYOUT", "LETTER"] },
];
export const stageIndex = (state: string) =>
  state === "CLOSED" ? STAGES.length : STAGES.findIndex((s) => s.states.includes(state));

export const ROLE = { claims_processor: "Claims processor", medical_reviewer: "Medical reviewer" } as const;

export function statusLine(c: Pick<ClaimRow, "state" | "waiting_for" | "paid_inr" | "draft_decision">): string {
  switch (c.state) {
    case "NOT_STARTED": return "New";
    case "WAITING_FOR_DOCS": return "Waiting for documents";
    case "WAITING_FOR_PROCESSOR": return "Needs a claims processor";
    case "WAITING_FOR_PROCESSOR_AND_REVIEWER":
      return c.waiting_for === "medical_reviewer" ? "Needs medical review" : "Needs a claims processor";
    case "AUTO_APPROVED": return "Approved";
    case "PAYOUT": case "LETTER": return "Payment in progress";
    case "CLOSED": return c.paid_inr ? `Paid ${inrExact(c.paid_inr)}` : "Closed, not paid";
    default: return "Being assessed";
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
  NON_PAYABLE: "Items not covered",
  ROOM_RENT_PROPORTIONATE: "Room above daily limit",
  SUB_LIMIT: "Treatment limit",
  CO_PAY: "Member's share (60+)",
  BALANCE_CAP: "Cover left this year",
};

export const FLAG: Record<string, { title: string; body: string }> = {
  WAITING_PERIOD: { title: "Waiting period", body: "The treatment falls inside a waiting period of the policy." },
  DUPLICATE: { title: "Possible duplicate", body: "This hospital bill seems to have been claimed before." },
  LATE_FILING: { title: "Filed late", body: "Filed more than 30 days after discharge. Decide whether to accept it." },
  WATCHLIST_HOSPITAL: { title: "Hospital on watch list", body: "Claims from this hospital are always checked by a person." },
  DATE_MISMATCH: { title: "Dates don't match", body: "The bill and the discharge summary give different dates." },
  BILL_TOTAL_MISMATCH: { title: "Bill doesn't add up", body: "The bill total doesn't match its items. The items were used." },
  INSTRUCTION_IN_DOCUMENT: { title: "Note on a document", body: "A document contains unusual instructions. Please check it." },
};

export const REJECT: Record<string, string> = {
  POLICY_INACTIVE: "The policy wasn't active on the admission date",
  WAITING_PERIOD: "The treatment is inside a waiting period",
  DUPLICATE: "This bill was already claimed",
};

export const DOC_LABEL: Record<string, string> = {
  discharge_summary: "discharge summary", prescription: "prescription", receipt: "payment receipt", final_bill: "final hospital bill",
};
