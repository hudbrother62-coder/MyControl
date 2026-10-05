"use client";
import { FormEvent, useEffect, useState } from "react";
import Logo from "@/components/Logo";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false),
    [allowed, setAllowed] = useState(false);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [msg, setMsg] = useState("");

  async function checkAccess() {
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store" });
      const data = await r.json();
      setAllowed(Boolean(data.ok));
    } catch {
      setAllowed(false);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    checkAccess();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg("Memproses...");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        setMsg(data?.error || "Username atau password salah.");
        return;
      }

      setAllowed(true);
      setMsg("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Login gagal.");
    }
  }

  if (!ready)
    return (
      <div className="authScreen">
        <div className="authCard">
          <div className="authLogo">
            <Logo />
          </div>
          <h1>My Control</h1>
          <p>Menyiapkan sesi aman...</p>
        </div>
      </div>
    );
  if (allowed) return <>{children}</>;

  return (
    <div className="authScreen">
      <form className="authCard" onSubmit={submit}>
        <div className="authLogo">
          <Logo />
        </div>
        <h1>My Control</h1>
        <p>Masuk ke pusat kontrol Bantu Beres.</p>
        <input
          className="input"
          autoComplete="username"
          required
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary authBtn">Masuk</button>
        {msg && <div className="notice">{msg}</div>}
      </form>
    </div>
  );
}
