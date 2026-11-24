// Light / dark choice. "system" follows the device; "light"/"dark" are saved and win over it.
// The choice lives on <html data-theme>; index.css and Tailwind's dark: variant both read it.
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "harborline-theme";
const listeners = new Set<(c: ThemeChoice) => void>();

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function setChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* storage blocked: the choice still applies for this visit */ }
  apply(choice);
  listeners.forEach((l) => l(choice));
}

/** The saved choice, plus the theme actually showing (resolving "system" against the device). */
export function useTheme() {
  const [choice, setLocal] = useState<ThemeChoice>(() => readChoice());
  const [deviceDark, setDeviceDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    listeners.add(setLocal);
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDeviceDark(m.matches);
    m.addEventListener("change", on);
    return () => { listeners.delete(setLocal); m.removeEventListener("change", on); };
  }, []);
  const effective: "light" | "dark" = choice === "system" ? (deviceDark ? "dark" : "light") : choice;
  return { choice, effective, setChoice };
}
