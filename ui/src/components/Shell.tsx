import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ChevronRight, FileStack, LayoutDashboard, LifeBuoy, Loader2, LogOut, ShieldPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import { ROLE } from "../words";
import { Avatar, EASE } from "./bits";

function Mark({ size = 34 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }}
      className="relative flex shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-sky to-brand text-onbrand shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_8px_18px_-8px_rgb(var(--brand)/0.8)] ring-1 ring-inset ring-white/25">
      <ShieldPlus size={size * 0.52} strokeWidth={2.2} />
    </span>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      <span className={`text-[15px] font-semibold tracking-tight text-ink ${compact ? "hidden sm:inline" : ""}`}>
        Harborline <span className="font-normal text-ink2">Claims</span>
      </span>
    </span>
  );
}

const NAV = [
  { to: "/", end: true, label: "Dashboard", Icon: LayoutDashboard },
  { to: "/claims", end: false, label: "Claims", Icon: FileStack },
  { to: "/help", end: false, label: "Help", Icon: LifeBuoy },
] as const;

function Nav() {
  const reduce = useReducedMotion();
  return (
    <nav aria-label="Main" className="well flex w-full items-center gap-0.5 rounded-full p-1 sm:w-auto">
      {NAV.map(({ to, end, label, Icon }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) =>
            `relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/50 sm:flex-none sm:px-3.5 ${isActive ? "text-ink" : "text-ink2 hover:text-ink"}`}>
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span layoutId="nav-highlight" aria-hidden
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                  className="glass-strong absolute inset-0 rounded-full" style={{ boxShadow: "inset 0 1px 0 rgb(255 255 255 / var(--hi-a)), 0 4px 12px -4px rgb(var(--shadow) / 0.25)" }} />
              )}
              <Icon size={15} className={`relative ${isActive ? "text-brand" : ""}`} aria-hidden />
              <span className="relative">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function Shell({ user, onSignOut, children }: { user: User; onSignOut: () => void; children: React.ReactNode }) {
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const section = useLocation().pathname.split("/")[1] ?? "";
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
        <motion.header
          initial={reduce ? false : { opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
          className="glass-strong mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 rounded-[22px] px-3 py-2 sm:flex-nowrap sm:rounded-full sm:pl-3 sm:pr-2">
          <button onClick={() => nav("/")} aria-label="Harborline Claims home"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/50"><Logo compact /></button>
          <div className="order-last w-full sm:order-none sm:ml-3 sm:w-auto"><Nav /></div>
          <div className="ml-auto flex items-center gap-2.5">
            <div className="hidden text-right md:block">
              <div className="text-sm font-medium leading-tight text-ink">{user.name}</div>
              <div className="text-xs text-ink3">{ROLE[user.role]}</div>
            </div>
            <Avatar name={user.name} size={34} />
            <button aria-label="Sign out" title="Sign out" onClick={async () => { await api.logout(); onSignOut(); }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink2 outline-none transition-colors hover:bg-sunken/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50">
              <LogOut size={17} />
            </button>
          </div>
        </motion.header>
      </div>
      <motion.main key={section}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0.15 : 0.5, ease: EASE }}
        className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </motion.main>
    </div>
  );
}

const ROLE_BLURB = {
  claims_processor: "Review, approve or reject claims",
  medical_reviewer: "Second approval on larger claims",
} as const;

export function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const reduce = useReducedMotion();
  const [people, setPeople] = useState<User[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.users().then(setPeople).catch(() => setErr("We couldn't reach the server. Please try again shortly.")); }, []);

  const pick = async (p: User) => {
    setBusy(p.user_id); setErr(null);
    try { onSignedIn(await api.login(p.user_id)); }
    catch { setErr("We couldn't sign you in. Please try again."); setBusy(null); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="glass-strong w-full max-w-sm rounded-[32px] p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <Mark size={52} />
          <div className="mt-4 text-sm font-semibold tracking-tight text-ink">Harborline <span className="font-normal text-ink2">Claims</span></div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink2">Choose your account to continue.</p>
        </div>
        <div className="mt-6 space-y-2.5">
          {people?.map((p, i) => (
            <motion.button key={p.user_id} onClick={() => pick(p)} disabled={!!busy}
              initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.15 + i * 0.06 }}
              whileHover={reduce || busy ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.985 }}
              className="group flex w-full items-center gap-3 rounded-2xl border border-[rgb(var(--edge)/var(--edge-a))] bg-[rgb(var(--glass)/0.5)] p-3 text-left shadow-card outline-none transition-[background-color,box-shadow,border-color] hover:border-brand/40 hover:bg-[rgb(var(--glass)/0.85)] hover:shadow-float focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-wait disabled:opacity-70">
              <Avatar name={p.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{p.name}</span>
                <span className="block text-xs font-medium text-brand">{ROLE[p.role]}</span>
                <span className="block text-xs text-ink3">{ROLE_BLURB[p.role]}</span>
              </span>
              {busy === p.user_id
                ? <Loader2 size={17} className="animate-spin text-brand" aria-label="Signing in" />
                : <ChevronRight size={17} className="text-ink3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />}
            </motion.button>
          ))}
          {!people && !err && (
            <div className="well flex items-center justify-center gap-2 py-6 text-sm text-ink3">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          )}
          {err && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl bg-crit/10 p-3 text-sm text-crit ring-1 ring-inset ring-crit/25">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
