// Hand-drawn charts for the dashboard. Thin marks, recessive grid, ink-coloured text,
// a tooltip on every mark (hover, tap and keyboard focus) and a table twin for each chart.
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { EASE } from "./bits";

export type Datum = { label: string; value: number; /** shown in the tooltip under the value */ hint?: string };

/** Measures an element's width and keeps it current. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A clean upper bound and tick step for an axis of counts or amounts. */
function niceScale(max: number, ticks = 3) {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  return { top: Math.ceil(max / step) * step, step };
}

const fmtCount = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n.toLocaleString("en-IN"));

/** Rounded 4px data-end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Floating readout. Value leads, label follows. */
function Tip({ x, y, width, value, label, hint }: { x: number; y: number; width: number; value: string; label: string; hint?: string }) {
  const left = Math.max(70, Math.min(width - 70, x));
  return (
    <div role="status" aria-live="polite"
      className="glass-strong pointer-events-none absolute z-20 min-w-[7rem] -translate-x-1/2 -translate-y-full rounded-2xl px-3 py-2 text-center"
      style={{ left, top: y - 8 }}>
      <div className="text-sm font-semibold text-ink">{value}</div>
      <div className="text-xs text-ink2">{label}</div>
      {hint && <div className="text-[11px] text-ink3">{hint}</div>}
    </div>
  );
}

/** Hover, focus and tap all point at one active mark. */
function useActive() {
  const [active, setActive] = useState<number | null>(null);
  const bind = useCallback((i: number) => ({
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === "mouse") setActive(i); },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === "mouse") setActive(null); },
    onClick: () => setActive((a) => (a === i ? null : i)),
    onFocus: () => setActive(i),
    onBlur: () => setActive(null),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") setActive(null); },
  }), []);
  return { active, bind };
}

/**
 * Vertical columns, one series, one colour. Labels every value when there are few columns,
 * otherwise only the highest and the latest; the y-axis and tooltip carry the rest.
 */
export function ColumnChart({ data, unit = "claims", height = 170, title }: {
  data: Datum[]; unit?: string; height?: number; title: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const reduce = useReducedMotion();
  const { active, bind } = useActive();
  const padL = 30, padT = 20, padB = 24, padR = 4;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const max = Math.max(0, ...data.map((d) => d.value));
  const { top, step } = niceScale(max);
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  const band = data.length ? plotW / data.length : 0;
  const bw = Math.max(4, Math.min(24, band * 0.56));
  const y = (v: number) => padT + plotH - (top ? (v / top) * plotH : 0);
  const labelAll = data.length <= 8;
  const maxIdx = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  const labelEvery = Math.max(1, Math.ceil((data.length * 46) / Math.max(1, plotW)));

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label={title} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink3 text-[10px] tabular">{fmtCount(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = padL + band * i + band / 2;
            const h = y(0) - y(d.value);
            const showValue = labelAll || i === maxIdx || i === data.length - 1;
            const dim = active !== null && active !== i;
            return (
              <g key={d.label}>
                <motion.path
                  d={columnPath(cx - bw / 2, y(d.value), bw, h)}
                  fill="rgb(var(--brand))"
                  initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1, opacity: dim ? 0.45 : 1 }}
                  transition={{ duration: reduce ? 0 : 0.7, ease: EASE, delay: reduce ? 0 : 0.15 + i * 0.04 }}
                  style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
                />
                {showValue && d.value > 0 && (
                  <text x={cx} y={y(d.value) - 6} textAnchor="middle" className="fill-ink2 text-[11px] font-semibold">{fmtCount(d.value)}</text>
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-ink3 text-[10px]">{d.label}</text>
                )}
                {/* hit target: the whole band, taller than the mark */}
                <rect x={padL + band * i} y={padT - 10} width={band} height={plotH + 10} fill="transparent"
                  tabIndex={0} role="img" aria-label={`${d.label}: ${d.value} ${unit}${d.hint ? `, ${d.hint}` : ""}`}
                  className="cursor-pointer outline-none focus-visible:stroke-brand focus-visible:[stroke-width:2]" rx={8}
                  {...bind(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && data[active] && (
        <Tip x={padL + band * active + band / 2} y={y(data[active].value)} width={width}
          value={`${data[active].value.toLocaleString("en-IN")} ${data[active].value === 1 ? unit.replace(/s$/, "") : unit}`}
          label={data[active].label} hint={data[active].hint} />
      )}
    </div>
  );
}

/** Horizontal bars, one series, value at each tip. For a short list of categories. */
export function BarList({ data, unit = "claims", title }: { data: Datum[]; unit?: string; title: string }) {
  const reduce = useReducedMotion();
  const { active, bind } = useActive();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-1" aria-label={title}>
      {data.map((d, i) => {
        const dim = active !== null && active !== i;
        return (
          <li key={d.label} className="relative">
            <div tabIndex={0} role="img" aria-label={`${d.label}: ${d.value} ${unit}`}
              className="cursor-pointer rounded-xl px-2 py-1.5 outline-none transition-colors hover:bg-ink3/5 focus-visible:ring-2 focus-visible:ring-brand"
              {...bind(i)}>
              <div className="mb-1 truncate text-xs font-medium text-ink2">{d.label}</div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <motion.div
                    className="h-3 rounded-r bg-brand"
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${(d.value / max) * 100}%`, opacity: dim ? 0.45 : 1 }}
                    transition={{ duration: reduce ? 0 : 0.7, ease: EASE, delay: reduce ? 0 : 0.2 + i * 0.05 }}
                    style={{ minWidth: d.value > 0 ? 4 : 0 }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-semibold text-ink tabular">{d.value}</span>
              </div>
            </div>
            {active === i && (
              <div role="status" className="glass-strong pointer-events-none absolute bottom-full left-1/2 z-20 -translate-x-1/2 rounded-2xl px-3 py-2 text-center">
                <div className="text-sm font-semibold text-ink">{d.value} {d.value === 1 ? unit.replace(/s$/, "") : unit}</div>
                <div className="whitespace-nowrap text-xs text-ink2">{d.label}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type Part = { label: string; value: number; color: string; display: string };

/**
 * One whole split into parts: a tall (28px) segmented bar with 2px gaps,
 * and each part's name, amount and share printed under its own end.
 */
export function SegmentedBar({ parts, title }: { parts: Part[]; title: string }) {
  const reduce = useReducedMotion();
  const { active, bind } = useActive();
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const pct = (v: number) => {
    const p = (v / total) * 100;
    return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  return (
    <div aria-label={title} role="group">
      <div className="relative flex h-7 w-full gap-[2px]">
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <motion.div key={p.label} tabIndex={0} role="img"
            aria-label={`${p.label}: ${p.display}, ${pct(p.value)}`}
            className="relative h-full cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            style={{ background: p.color, minWidth: 6 }}
            initial={reduce ? false : { flexGrow: 0, opacity: 0 }}
            animate={{ flexGrow: p.value, opacity: active !== null && parts[active]?.label !== p.label ? 0.5 : 1 }}
            transition={{ duration: reduce ? 0 : 0.8, ease: EASE, delay: reduce ? 0 : 0.2 + i * 0.08 }}
            {...bind(parts.indexOf(p))}>
            {active === parts.indexOf(p) && (
              <div role="status" className="glass-strong pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-2xl px-3 py-2 text-center">
                <div className="whitespace-nowrap text-sm font-semibold text-ink">{p.display}</div>
                <div className="whitespace-nowrap text-xs text-ink2">{p.label} · {pct(p.value)}</div>
              </div>
            )}
          </motion.div>
        ))}
      </div>
      {/* legend + direct labels: each part's name and value, under its own end of the bar */}
      <ul className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-2">
        {parts.map((p, i) => (
          <li key={p.label} className={`flex items-start gap-2 ${i === parts.length - 1 && parts.length > 1 ? "text-right sm:flex-row-reverse" : ""}`}>
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span>
              <span className="block text-xs text-ink2">{p.label}</span>
              <span className="block text-sm font-semibold text-ink">{p.display} <span className="font-normal text-ink3">· {pct(p.value)}</span></span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The table twin every chart offers. */
export function DataTable({ head, rows, caption }: { head: [string, string]; rows: [string, string][]; caption: string }) {
  return (
    <div className="well max-h-64 overflow-auto p-2">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs text-ink3">
            <th scope="col" className="px-2 py-1.5 font-medium">{head[0]}</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-line/70">
              <th scope="row" className="px-2 py-1.5 text-left font-normal text-ink2">{a}</th>
              <td className="px-2 py-1.5 text-right font-semibold text-ink tabular">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A small "Show as table" switch for a chart window's title bar. */
export function TableToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className="rounded-full px-2.5 py-1 text-xs font-medium text-ink2 ring-1 ring-inset ring-line transition-colors hover:bg-ink3/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {on ? "Show as chart" : "Show as table"}
    </button>
  );
}
