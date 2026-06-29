"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, tokenStore } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fn = mode === "login" ? api.login : api.register;
      const { accessToken } = await fn(email, password);
      tokenStore.set(accessToken);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">QueueFlow</h1>
          <p className="text-sm text-muted">
            {mode === "login" ? "Sign in to the dashboard" : "Create an account"}
          </p>
        </div>

        <input
          className="input"
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Register"}
        </button>

        <button
          type="button"
          className="w-full text-center text-xs text-muted hover:text-ink"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
