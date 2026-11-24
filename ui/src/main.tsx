import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, type User } from "./api";
import { SpatialBackdrop } from "./components/bits";
import { ClaimPage } from "./components/ClaimPage";
import { Dashboard } from "./components/Dashboard";
import { Desk } from "./components/Desk";
import { Help } from "./components/Help";
import { Shell, SignIn } from "./components/Shell";
import "./index.css";

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { api.me().then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <SpatialBackdrop />;
  if (user === null) return <><SpatialBackdrop /><SignIn onSignedIn={setUser} /></>;
  return (
    <>
      <SpatialBackdrop />
      <Shell user={user} onSignOut={() => setUser(null)}>
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/claims" element={<Desk user={user} />} />
          <Route path="/claims/:id" element={<ClaimPage user={user} />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </React.StrictMode>,
);
