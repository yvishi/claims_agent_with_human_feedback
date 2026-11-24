import { motion, useDragControls } from "framer-motion";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
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

export function useMediaQuery(q: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return match;
}

export const EASE = [0.22, 1, 0.36, 1] as const;

/** The fixed backdrop every page floats over. Render once, in the app root. */
export function SpatialBackdrop() {
  return (
    <div className="spatial-bg" aria-hidden>
      <span className="orb" style={{ width: 520, height: 520, left: "-8%", top: "8%", background: "rgb(var(--sky))" }} />
      <span className="orb" style={{ width: 460, height: 460, right: "-6%", top: "-6%", background: "rgb(var(--mist))", animationDelay: "-9s" }} />
      <span className="orb" style={{ width: 600, height: 600, right: "18%", bottom: "-22%", background: "rgb(var(--brand))", opacity: 0.25, animationDelay: "-16s" }} />
    </div>
  );
}

const TONE: Record<Tone, { cls: string; Icon: typeof Clock }> = {
  good: { cls: "bg-good/10 text-good ring-good/25", Icon: CheckCircle2 },
  warn: { cls: "bg-warn/15 text-[rgb(150_96_0)] dark:text-warn ring-warn/35", Icon: Clock },
  crit: { cls: "bg-crit/10 text-crit ring-crit/25", Icon: XCircle },
  brand: { cls: "bg-brand/10 text-brand ring-brand/20", Icon: Loader2 },
  muted: { cls: "bg-ink3/10 text-ink2 ring-ink3/20", Icon: Clock },
};

/** Status always carries an icon and words, never colour alone. */
export function Pill({ tone, children, spin }: { tone: Tone; children: React.ReactNode; spin?: boolean }) {
  const { cls, Icon } = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      <Icon size={13} className={spin || tone === "brand" ? "animate-spin" : ""} aria-hidden />
      {children}
    </span>
  );
}

/** A glass pane. `title` and `action` make a header row. */
export function Card({ children, className = "", title, action, delay = 0 }:
  { children: React.ReactNode; className?: string; title?: React.ReactNode; action?: React.ReactNode; delay?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE, delay }}
      className={`glass p-5 ${className}`}
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

let zTop = 10;

/**
 * A spatial window: glass, a title bar, and (on wide screens) draggable by its grab bar,
 * coming to the front when touched. Pass `bounds` (a ref to the area it may move in).
 * On narrow screens it is a normal stacked pane.
 */
export function FloatingWindow({ title, icon, action, children, className = "", bounds, delay = 0 }: {
  title: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
  className?: string; bounds?: RefObject<HTMLElement>; delay?: number;
}) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const controls = useDragControls();
  const [z, setZ] = useState(1);
  const front = () => setZ(++zTop);
  return (
    <motion.section
      drag={wide} dragListener={false} dragControls={controls} dragMomentum={false} dragElastic={0.08}
      dragConstraints={bounds}
      onPointerDown={front}
      initial={{ opacity: 0, y: 28, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, ease: EASE, delay }}
      whileDrag={{ scale: 1.015 }}
      style={{ zIndex: z }}
      className={`glass-strong relative flex flex-col rounded-[28px] ${className}`}
    >
      <header className="flex items-center gap-2 px-5 pb-2 pt-4">
        {icon && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-brand">{icon}</span>}
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <div className="ml-auto">{action}</div>
      </header>
      <div className="min-h-0 flex-1 px-5 pb-4">{children}</div>
      {wide && (
        <button aria-label="Move window" onPointerDown={(e) => { front(); controls.start(e); }}
          className="group mx-auto mb-2 flex h-4 w-24 cursor-grab touch-none items-center justify-center active:cursor-grabbing">
          <span className="h-1.5 w-12 rounded-full bg-ink3/30 transition-all group-hover:w-16 group-hover:bg-ink3/60" />
        </button>
      )}
    </motion.section>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky to-brand font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] ring-2 ring-white/40 dark:text-surface">
      {initials}
    </span>
  );
}
