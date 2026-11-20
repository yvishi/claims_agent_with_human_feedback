export type User = { user_id: string; name: string; role: "claims_processor" | "medical_reviewer" };

export type ClaimRow = {
  claim_id: string; case?: string; scenario?: string;
  member_name: string; hospital_name: string; claimed_inr: string;
  admission_date: string; filed_on: string;
  state: string; sub_status: string | null; route: string | null; updated_at: string | null;
  waiting_for: "claims_processor" | "medical_reviewer" | "member" | null; busy: boolean;
  payable_inr: string | null; draft_decision: string | null; flags: string[]; paid_inr: string | null;
};

export type LineItem = {
  bill_no: string; line_no: number; description: string; category: string | null;
  billed_inr: string; payable_after_step2_inr: string; deduction_code: string | null;
  evidence?: { file: string; source_line: number; text: string } | null;
};
export type Deduction = { code: string; amount_inr: string; lines: number[]; why: string };
export type Draft = {
  decision: "approve" | "partial" | "reject"; reject_code: string | null;
  claimed_inr: string; payable_inr: string; deductions: Deduction[]; flags: string[];
  review_reasons: string[]; route: string; condition: string; age: number; notes: string[];
  line_items: LineItem[]; rules_version: string;
};
export type Approval = { step: string; actor: string; name: string; role: string; action: string; amount: string | null; reason: string | null; at: string };
export type TimelineEvent = { id: number; state: string | null; event: string; tool: string | null; result: any; actor: string; model: string | null; prompt_version: string | null; at: string };

export type ClaimDetail = {
  claim_id: string; case?: string; scenario?: string;
  claim: { cause: string; admission_date: string; discharge_date: string; filed_on: string; claimed_amount_inr: number; documents: string[]; policy_id: string };
  member: { name: string; gender: string; dob: string };
  payee: { name: string; account: string };
  hospital: { name: string; city: string; watch_list: boolean };
  policy: { plan: string; sum_insured_inr: string; remaining_inr: string; inception_date: string; period_start: string; period_end: string; status: string };
  run: { state: string; sub_status: string | null; route: string | null } | null;
  waiting_for: ClaimRow["waiting_for"]; busy: boolean;
  draft: Draft | null; approvals: Approval[];
  payments: { payment_id: string; idempotency_key: string; amount_inr: string; created_at: string }[];
  payment_status: { status: string; attempts: number } | null;
  documents: { filename: string; uploaded_at: string }[];
  emails: { idempotency_key: string; kind: string; doc_type: string | null; subject: string; sent_at: string }[];
  letter: { body: string; template: boolean; at: string } | null;
  timeline: TimelineEvent[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail ?? msg; } catch { /* keep statusText */ }
    throw new ApiError(r.status, msg);
  }
  return r.json();
}

export const api = {
  users: () => call<User[]>("/api/users"),
  me: () => call<User>("/api/me"),
  login: (user_id: string) => call<User>("/api/login", { method: "POST", body: JSON.stringify({ user_id }) }),
  logout: () => call("/api/logout", { method: "POST" }),
  claims: () => call<ClaimRow[]>("/api/claims"),
  claim: (id: string) => call<ClaimDetail>(`/api/claims/${id}`),
  start: (id: string) => call(`/api/claims/${id}/start`, { method: "POST" }),
  act: (id: string, body: { action: string; amount_inr?: number; reason?: string }) =>
    call(`/api/claims/${id}/actions`, { method: "POST", body: JSON.stringify(body) }),
  deliverMissing: (id: string) => call<{ delivered: string[] }>(`/api/claims/${id}/deliver-missing`, { method: "POST" }),
  reset: () => call("/api/demo/reset", { method: "POST" }),
};
