import { CheckCircle2, ClipboardCheck, Clock, Inbox, Loader2, Route, Tags, XCircle, type LucideIcon } from "lucide-react";
import type { Tone } from "../words";
import { Card } from "./bits";

const STATUSES: [string, Tone, string][] = [
  ["New", "muted", "Received but not assessed yet. Use “Process new claims” to start."],
  ["Being assessed", "brand", "Documents and bills are being checked against the policy."],
  ["Waiting for documents", "warn", "The member has been asked for something missing. The claim continues once it arrives."],
  ["Needs your decision", "warn", "The claim is ready for you to approve, change or reject."],
  ["Needs medical review", "warn", "Claims over ₹1,00,000 need a second approval from the medical reviewer."],
  ["Payment in progress", "brand", "Approved and being paid to the member."],
  ["Paid / Closed", "good", "Finished. The member has been sent a letter explaining the amount."],
];

/** Same look as the Pill in bits, but without the spinner so the guide sits still. */
const BADGE: Record<Tone, { cls: string; Icon: LucideIcon }> = {
  good: { cls: "bg-good/10 text-good ring-good/25", Icon: CheckCircle2 },
  warn: { cls: "bg-warn/15 text-[rgb(150_96_0)] dark:text-warn ring-warn/35", Icon: Clock },
  crit: { cls: "bg-crit/10 text-crit ring-crit/25", Icon: XCircle },
  brand: { cls: "bg-brand/10 text-brand ring-brand/20", Icon: Loader2 },
  muted: { cls: "bg-ink3/10 text-ink2 ring-ink3/20", Icon: Inbox },
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const { cls, Icon } = BADGE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      <Icon size={13} aria-hidden /> {children}
    </span>
  );
}

function Title({ Icon, children }: { Icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-brand ring-1 ring-inset ring-brand/20"><Icon size={16} /></span>
      {children}
    </span>
  );
}

const STEPS: React.ReactNode[] = [
  <>Open a claim from <b className="text-ink">Needs your decision</b>.</>,
  <>Check the recommended amount and any items under <b className="text-ink">Please check</b>.</>,
  <><b className="text-ink">Approve</b> the amount, <b className="text-ink">change</b> it, or <b className="text-ink">reject</b> the claim. Changes and rejections need a reason, which the member sees.</>,
];

const ROUTING = [
  "Small, straightforward claims are approved automatically.",
  "Claims over ₹25,000, or with anything unusual, go to a claims processor.",
  "Claims over ₹1,00,000 also need the medical reviewer.",
  "No claim is rejected without a person deciding.",
];

export function Help() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="eyebrow">Guide</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Help</h1>
        <p className="mt-1 text-ink2">A quick guide to working with claims.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={<Title Icon={ClipboardCheck}>Making a decision</Title>} className="rounded-[28px]">
          <ol className="space-y-3 text-sm text-ink2">
            {STEPS.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky to-brand text-xs font-semibold text-onbrand">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title={<Title Icon={Route}>Which claims come to you</Title>} className="rounded-[28px]" delay={0.06}>
          <ul className="space-y-3 text-sm text-ink2">
            {ROUTING.map((s) => (
              <li key={s} className="flex gap-3">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky shadow-[0_0_8px_rgb(var(--sky)/0.8)]" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={<Title Icon={Tags}>What the statuses mean</Title>} className="rounded-[28px]" delay={0.12}>
        <dl className="space-y-1.5">
          {STATUSES.map(([k, t, v]) => (
            <div key={k} className="well grid items-center gap-2 px-3 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4">
              <dt><Badge tone={t}>{k}</Badge></dt>
              <dd className="text-sm text-ink2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
