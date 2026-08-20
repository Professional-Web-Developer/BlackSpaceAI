"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "login" | "register";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body: { error?: string; issues?: { message: string }[] } =
          await response.json().catch(() => ({}));
        // Zod issues are more specific than the generic message, so prefer
        // them when present ("Use at least 12 characters").
        setError(
          body.issues?.[0]?.message ?? body.error ?? "Something went wrong",
        );
        return;
      }

      // A server component reads the session, so the cache has to be dropped
      // before navigating or the signed-out page would be served from it.
      router.refresh();
      router.push("/");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          className={mode === "login" ? "selected" : ""}
          onClick={() => setMode("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className={mode === "register" ? "selected" : ""}
          onClick={() => setMode("register")}
        >
          Create account
        </button>
      </div>

      <label>
        Email
        <input
          type="email"
          value={email}
          autoComplete="email"
          required
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label>
        Password
        <input
          type="password"
          value={password}
          autoComplete={
            mode === "login" ? "current-password" : "new-password"
          }
          required
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {mode === "register" && (
        <p className="hint">At least 12 characters. Length beats complexity.</p>
      )}

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={busy}>
        {busy
          ? "Working…"
          : mode === "login"
            ? "Sign in"
            : "Create account"}
      </button>
    </form>
  );
}
