import { motion } from "framer-motion";
import { useState } from "react";
import type { ClaimDetail } from "../api";
import { DEDUCTION, REJECT, inrExact } from "../words";
import { Card } from "./bits";

type Row = { label: string; value: number; start: number; kind: "claimed" | "deduct" | "paid" | "edit"; why?: string };

/** "Where the money went": a horizontal bridge from what was claimed to what is paid.
 *  One bar per step, direct labels, hover/tap for the reason. */
export function MoneyStory({ c }: { c: ClaimDetail }) {
  const d = c.draft!;
  const [hover, setHover] = useState<number | null>(null);
  const claimed = Number(d.claimed_inr);
  if (d.decision === "reject") {
    return (
      <Card title="Where the money went">
        <p className="text-ink2">The agent found this claim can't be paid: <b className="text-ink">{REJECT[d.reject_code ?? ""] ?? d.reject_code}</b>. A claims processor makes the final call.</p>
        {d.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink2">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </Card>
    );
  }
  const rows: Row[] = [{ label: "Claimed", value: claimed, start: 0, kind: "claimed" }];
  let running = claimed;
  const dedTotal = d.deductions.reduce((s, x) => s + Number(x.amount_inr), 0);
  const gap = claimed - dedTotal - Number(d.payable_inr);
  if (gap > 0.01) {  // bill lines add up to less than the claim (paid from the lines)
    running -= gap;
    rows.push({ label: "Bill lines add up to less", value: gap, start: running, kind: "deduct", why: "The bill's lines total less than the amount claimed. We pay from the lines." });
  }
  for (const x of d.deductions) {
    running -= Number(x.amount_inr);
    rows.push({ label: DEDUCTION[x.code] ?? x.code, value: Number(x.amount_inr), start: running, kind: "deduct", why: x.why });
  }
  rows.push({ label: "Payable", value: Number(d.payable_inr), start: 0, kind: "paid" });
  const edit = [...c.approvals].reverse().find((a) => a.action === "edit");
  if (edit?.amount) rows.push({ label: `Approved after review`, value: Number(edit.amount), start: 0, kind: "edit", why: edit.reason ?? undefined });

  const color = { claimed: "bg-ink3/40", deduct: "bg-deduct", paid: "bg-paid", edit: "bg-paid" };
  return (
    <Card title="Where the money went" action={
      <span className="flex items-center gap-3 text-xs text-ink2">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-ink3/40" /> Claimed</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-deduct" /> Deducted</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-paid" /> Paid</span>
      </span>}>
      <div className="space-y-[2px]">
        {rows.map((r, i) => (
          <div key={i} className="relative grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 py-1.5 sm:grid-cols-[210px_1fr_110px]"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
            <div className={`truncate text-sm ${r.kind === "paid" || r.kind === "edit" ? "font-semibold" : "text-ink2"}`}>
              {r.kind === "deduct" && "− "}{r.label}
            </div>
            <div className="relative h-7 rounded-[4px] bg-sunken/60">
              <motion.div className={`absolute top-0 h-full rounded-[4px] ${color[r.kind]} ${hover === i ? "ring-2 ring-raised" : ""}`}
                style={{ left: `${(r.start / claimed) * 100}%` }}
                initial={{ width: 0 }} animate={{ width: `${Math.max((r.value / claimed) * 100, 0.6)}%` }}
                transition={{ duration: 0.8, delay: 0.15 + i * 0.18, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <div className={`text-right text-sm tabular ${r.kind === "paid" || r.kind === "edit" ? "font-semibold" : ""}`}>{inrExact(r.value)}</div>
            {hover === i && r.why && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-line bg-raised p-3 text-sm text-ink2 shadow-card sm:left-[222px] sm:right-[122px]">
                {r.why}
              </motion.div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink3">Rules apply in a fixed order: items not covered, room limit, treatment limits, co-pay, then remaining cover. Hover or tap a bar for the reason.</p>
    </Card>
  );
}
