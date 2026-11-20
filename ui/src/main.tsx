import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { api, type User } from "./api";
import { ClaimPage } from "./components/ClaimPage";
import { Desk } from "./components/Desk";
import { HowItWorks } from "./components/HowItWorks";
import { Shell, SignIn } from "./components/Shell";
import "./index.css";

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { api.me().then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return null;
  if (user === null) return <SignIn onSignedIn={setUser} />;
  return (
    <Shell user={user} onSignOut={() => setUser(null)}>
      <Routes>
        <Route path="/" element={<Desk user={user} />} />
        <Route path="/claims/:id" element={<ClaimPage user={user} />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
      </Routes>
    </Shell>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </React.StrictMode>,
);
