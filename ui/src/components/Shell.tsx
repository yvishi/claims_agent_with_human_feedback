import { AnimatePresence, motion } from "framer-motion";
import { LogOut, ShieldPlus } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import { ROLE } from "../words";
import { Avatar } from "./bits";

export function Shell({ user, onSignOut, children }: { user: User; onSignOut: () => void; children: React.ReactNode }) {
  const nav = useNavigate();
  const location = useLocation();
  const link = ({ isActive }: { isActive: boolean }) =>
    `relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? "text-ink" : "text-ink2 hover:text-ink"}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <button onClick={() => nav("/")} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-white"><ShieldPlus size={18} /></span>
            <span className="text-[15px] font-semibold tracking-tight">Harborline <span className="font-normal text-ink2">Claims</span></span>
          </button>
          <nav className="ml-2 hidden items-center gap-1 sm:flex">
            <NavLink to="/" end className={link}>Claims desk</NavLink>
            <NavLink to="/how-it-works" className={link}>How it works</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight">{user.name}</div>
              <div className="text-xs text-ink3">{ROLE[user.role]}</div>
            </div>
            <Avatar name={user.name} />
            <button aria-label="Sign out" onClick={async () => { await api.logout(); onSignOut(); }}
              className="rounded-lg p-2 text-ink2 hover:bg-sunken hover:text-ink"><LogOut size={17} /></button>
          </div>
        </div>
        <nav className="flex gap-1 px-4 pb-2 sm:hidden">
          <NavLink to="/" end className={link}>Claims desk</NavLink>
          <NavLink to="/how-it-works" className={link}>How it works</NavLink>
        </nav>
      </header>
      <AnimatePresence mode="wait">
        <motion.main key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const people: (User & { blurb: string })[] = [
    { user_id: "u_proc_01", name: "Asha Pillai", role: "claims_processor", blurb: "Approves, adjusts or rejects claims" },
    { user_id: "u_proc_02", name: "Deepak Rao", role: "claims_processor", blurb: "Approves, adjusts or rejects claims" },
    { user_id: "u_med_01", name: "Sunil Varma", role: "medical_reviewer", blurb: "Second sign-off on claims over ₹1,00,000" },
  ];
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-10 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-card"><ShieldPlus size={28} /></span>
          <h1 className="text-3xl font-semibold tracking-tight">Harborline Claims Desk</h1>
          <p className="mt-2 text-ink2">The agent prepares every claim and does the arithmetic. People approve the money.</p>
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-3">
          {people.map((p, i) => (
            <motion.button key={p.user_id}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}
              whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
              onClick={async () => onSignedIn(await api.login(p.user_id))}
              className="rounded-2xl border border-line bg-raised p-5 text-left shadow-card transition-colors hover:border-brand">
              <span className="mb-4 block"><span className="inline-flex"><Avatar name={p.name} size={44} /></span></span>
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-brand">{ROLE[p.role]}</div>
              <div className="mt-2 text-sm text-ink2">{p.blurb}</div>
            </motion.button>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-ink3">Demo sign-in · fictional company · synthetic data only</p>
      </div>
    </div>
  );
}
