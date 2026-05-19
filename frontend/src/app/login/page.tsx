"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error ?? "failed");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="login-main">
      <h1 className="login-title">{mode === "login" ? "Login" : "Register"}</h1>
      <form onSubmit={submit} className="login-form">
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="input input-plain"
        />
        <input
          type="password"
          placeholder="password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="input input-plain"
        />
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "..." : mode === "login" ? "Login" : "Register"}
        </button>
      </form>
      {err && <p className="login-error">{err}</p>}
      <button
        onClick={() => setMode(mode === "login" ? "register" : "login")}
        className="btn-ghost login-toggle"
      >
        {mode === "login" ? "Need an account? Register" : "Have an account? Login"}
      </button>
    </main>
  );
}
