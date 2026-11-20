import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { Tone } from "../words";

/** Re-runs `fn` every `ms` while mounted; pauses when the tab is hidden. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) {
        try { const d = await fnRef.current(); if (alive) { setData(d); setError(null); } }
        catch (e) { if (alive) setError(e as Error); }
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const refresh = async () => { try { setData(await fnRef.current()); } catch (e) { setError(e as Error); } };
  return { data, error, refresh };
}

/** A number that counts up to its value when it changes. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return c.stop;
  }, [value, mv]);
  return <motion.span className="tabular">{text}</motion.span>;
}

const TONE: Record<Tone, { cls: string; Icon: typeof Clock }> = {
  good: { cls: "bg-good/10 text-good", Icon: CheckCircle2 },
  warn: { cls: "bg-warn/15 text-[rgb(158_104_0)] dark:text-warn", Icon: Clock },
  crit: { cls: "bg-crit/10 text-crit", Icon: XCircle },
  brand: { cls: "bg-brandsoft text-brand", Icon: Loader2 },
  muted: { cls: "bg-sunken text-ink2", Icon: Clock },
};

/** Status always carries an icon and words, never colour alone. */
export function Pill({ tone, children, spin }: { tone: Tone; children: React.ReactNode; spin?: boolean }) {
  const { cls, Icon } = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      <Icon size={13} className={spin || tone === "brand" ? "animate-spin" : ""} aria-hidden />
      {children}
    </span>
  );
}

export function FlagChip({ title }: { title: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-serious/15 px-2 py-0.5 text-xs font-medium text-[rgb(168_72_34)] dark:text-serious">
      <AlertTriangle size={12} aria-hidden /> {title}
    </span>
  );
}

export function Card({ children, className = "", title, action }: { children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border border-line bg-raised p-5 shadow-card ${className}`}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </motion.section>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brandsoft font-semibold text-brand">
      {initials}
    </span>
  );
}
