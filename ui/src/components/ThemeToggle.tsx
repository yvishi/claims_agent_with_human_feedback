import { motion, useReducedMotion } from "framer-motion";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme, type ThemeChoice } from "../theme";

const OPTIONS: { value: ThemeChoice; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Use device setting", Icon: Monitor },
];

/** Three small buttons: Light, Dark, or follow the device. The active one carries a sliding highlight. */
export function ThemeToggle({ id = "theme" }: { id?: string }) {
  const { choice, setChoice } = useTheme();
  const reduce = useReducedMotion();
  return (
    <div role="radiogroup" aria-label="Appearance" className="well flex items-center gap-0.5 rounded-full p-1">
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = choice === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={on}
            aria-label={value === "system" ? "Use the device's light or dark setting" : `Switch to ${label.toLowerCase()} mode`}
            title={label} onClick={() => setChoice(value)}
            className={`relative flex h-7 w-7 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/50 ${on ? "text-brand" : "text-ink3 hover:text-ink"}`}>
            {on && (
              <motion.span layoutId={`${id}-highlight`} aria-hidden
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                className="glass-strong absolute inset-0 rounded-full"
                style={{ boxShadow: "inset 0 1px 0 rgb(255 255 255 / var(--hi-a)), 0 3px 10px -4px rgb(var(--shadow) / 0.3)" }} />
            )}
            <Icon size={14} className="relative" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
