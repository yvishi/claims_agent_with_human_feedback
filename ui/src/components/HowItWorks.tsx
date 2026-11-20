import { AnimatePresence, motion } from "framer-motion";
import {
  Banknote, Bot, Calculator, EyeOff, FileSearch, Inbox, Mail, Pause, Play, ScanText, ShieldCheck, Sparkles, UserCheck, Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "./bits";

type Who = "Agent" | "Rules" | "Person" | "AI helper";
type Step = { icon: LucideIcon; title: string; who: Who[]; short: string; long: string; promise?: string };

const STEPS: Step[] = [
  { icon: Inbox, title: "Claim arrives", who: ["Agent"], short: "Form, bills, receipt, discharge summary",
    long: "The member sends the claim form with the hospital bill, the payment receipt and the discharge summary. The agent opens a file for the claim and starts keeping a record of every step." },
  { icon: FileSearch, title: "Documents checked", who: ["Agent"], short: "Anything missing? Ask once, then wait",
    long: "The agent checks the list of required documents. If one is missing it emails the member once and pauses. The claim waits safely — for days if needed — and carries on the moment the document arrives." },
  { icon: ScanText, title: "Bills read privately", who: ["Agent", "AI helper"], short: "Read on our computers; names and numbers hidden",
    long: "Bills are read on Harborline's own computers, including scanned paper. Names, phone numbers and bank details are replaced with placeholders before anything else happens. If a bill line has an unusual name, an AI helper suggests which kind of charge it is — it only ever sees the hidden version, and never sees or sets an amount.",
    promise: "Personal details never leave our machines" },
  { icon: ShieldCheck, title: "Policy checked", who: ["Rules"], short: "Active? Waiting period? Cover left?",
    long: "The policy rules are checked in a fixed order: was the policy active, is the treatment inside a waiting period, has this bill been claimed before, and how much cover is left this year." },
  { icon: Calculator, title: "Amount worked out", who: ["Rules"], short: "Same answer every time, to the paisa",
    long: "A calculator applies the policy line by line: items the policy doesn't cover, the daily room limit, treatment limits, the member's share for ages 60+, then the remaining cover. Two people looking at the same claim now always get the same amount, and every rupee has a written reason.",
    promise: "Money is calculated by fixed rules, never by AI" },
  { icon: UserCheck, title: "A person approves", who: ["Person"], short: "Over ₹25,000 or anything unusual",
    long: "Small, clear claims are approved automatically. Anything over ₹25,000, any concern, and every rejection goes to a claims processor. Claims over ₹1,00,000 also need the medical reviewer. A person can approve, change the amount with a reason, or reject.",
    promise: "No claim is ever rejected without a person" },
  { icon: Banknote, title: "Paid exactly once", who: ["Agent"], short: "Checked before every attempt",
    long: "Before paying, the agent confirms the approval is on record. If the payment service is slow or fails, it checks whether the money already went out before trying again — so a member is never paid twice, even if a computer crashes mid-payment.",
    promise: "Never paid twice" },
  { icon: Mail, title: "Letter explains it", who: ["Agent"], short: "Every deduction in plain words",
    long: "The member gets a letter listing what was paid, each deduction and the reason for it, with no internal codes. Auditors can replay the full history of the claim from the record." },
];

const WHO_STYLE: Record<Who, { cls: string; icon: LucideIcon }> = {
  Agent: { cls: "bg-brandsoft text-brand", icon: Bot },
  Rules: { cls: "bg-paid/10 text-paid", icon: Calculator },
  Person: { cls: "bg-warn/20 text-[rgb(158_104_0)] dark:text-warn", icon: Users },
  "AI helper": { cls: "bg-sunken text-ink2", icon: Sparkles },
};

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 3200);
    return () => clearInterval(t);
  }, [playing]);
  const s = STEPS[active];

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">How a claim gets paid</h1>
        <p className="mt-2 text-lg text-ink2">The agent does the preparation and the arithmetic. People approve the money. Every rupee paid or deducted has a reason you can read.</p>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-ink2">Step {active + 1} of {STEPS.length}</span>
          <button onClick={() => setPlaying(!playing)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm">
            {playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
          </button>
        </div>

        {/* The track: a claim token travels from step to step. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <div className="relative min-w-[720px]">
            <svg className="absolute left-0 right-0 top-[26px] h-1 w-full" preserveAspectRatio="none" aria-hidden>
              <line x1="3%" x2="97%" y1="2" y2="2" stroke="rgb(var(--line))" strokeWidth="3" />
              <line x1="3%" x2="97%" y1="2" y2="2" stroke="rgb(var(--brand))" strokeWidth="3" className="flowing" opacity="0.5" />
            </svg>
            <div className="relative grid" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}>
              {STEPS.map((st, i) => {
                const on = i === active, past = i < active;
                return (
                  <button key={st.title} onClick={() => { setActive(i); setPlaying(false); }} className="group flex flex-col items-center px-1 text-center">
                    <motion.span animate={{ scale: on ? 1.12 : 1 }}
                      className={`relative flex h-14 w-14 items-center justify-center rounded-2xl border-2 transition-colors
                        ${on ? "border-brand bg-brand text-white shadow-card" : past ? "border-brand/50 bg-brandsoft text-brand" : "border-line bg-raised text-ink3 group-hover:text-ink"}`}>
                      <st.icon size={22} />
                      {on && <motion.span layoutId="token" className="absolute -top-2 -right-2 h-4 w-4 rounded-full border-2 border-raised bg-deduct" transition={{ type: "spring", stiffness: 200, damping: 22 }} />}
                    </motion.span>
                    <span className={`mt-2 text-xs font-medium ${on ? "text-ink" : "text-ink2"}`}>{st.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}
            className="mt-6 grid gap-6 rounded-2xl bg-sunken/70 p-6 md:grid-cols-[1fr_260px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">{s.title}</h2>
                {s.who.map((w) => {
                  const W = WHO_STYLE[w];
                  return <span key={w} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${W.cls}`}><W.icon size={12} /> {w}</span>;
                })}
              </div>
              <p className="mt-1 text-sm font-medium text-ink2">{s.short}</p>
              <p className="mt-3 leading-relaxed text-ink">{s.long}</p>
            </div>
            {s.promise && (
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 }}
                className="flex flex-col justify-center rounded-xl border border-brand/30 bg-raised p-4">
                <ShieldCheck className="text-brand" size={22} />
                <div className="mt-2 font-semibold">{s.promise}</div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Who does what</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { w: "Agent" as Who, t: "Prepares the claim", b: "Checks documents, reads bills, calls the policy and payment systems, writes the letter, keeps the record." },
            { w: "Rules" as Who, t: "Decides the money", b: "A fixed calculator applies the policy in order. Same claim, same answer, every time." },
            { w: "Person" as Who, t: "Approves the money", b: "Processors and the medical reviewer approve, adjust with a reason, or reject." },
            { w: "AI helper" as Who, t: "Reads unusual wording", b: "Suggests a label for an unfamiliar bill line. Sees only hidden text. Never sets amounts or decisions." },
          ].map((x, i) => {
            const W = WHO_STYLE[x.w];
            return (
              <motion.div key={x.w} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
                <Card className="h-full">
                  <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${W.cls}`}><W.icon size={18} /></span>
                  <div className="mt-3 font-semibold">{x.t}</div>
                  <div className="text-xs font-medium text-ink3">{x.w}</div>
                  <p className="mt-2 text-sm text-ink2">{x.b}</p>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { icon: EyeOff, t: "Private by design", b: "Bills are read on our own computers. Names, phone numbers and bank details are hidden before any outside service sees anything." },
          { icon: Banknote, t: "Correct money, exactly once", b: "If a payment times out, we check before retrying. A crash mid-payment can't cause a second payment." },
          { icon: ShieldCheck, t: "Every rupee explained", b: "Each claim keeps a permanent record of every step, every tool used and every decision — who, what and when." },
        ].map((x) => (
          <Card key={x.t}>
            <x.icon className="text-brand" size={22} />
            <div className="mt-2 font-semibold">{x.t}</div>
            <p className="mt-1 text-sm text-ink2">{x.b}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
