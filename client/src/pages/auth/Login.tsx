import { useEffect, useState, type FormEvent } from "react";
import { takeAuthNotice } from "@/lib/authNotice";
import { Link, useLocation, useSearch } from "wouter";
import { LockKeyhole } from "lucide-react";
import { BrandMark } from "@/components/AppShell";
import { Field } from "@/components/ui/primitives";
import { HOME_FOR_ROLE, useAuth } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc";

function safeNext(next: string | null) {
  // Only same-app paths; never redirect to another origin.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export default function Login() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const next = safeNext(params.get("next"));
  const [notice] = useState(takeAuthNotice);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({
    onSuccess: me => {
      utils.auth.me.setData(undefined, me);
      void utils.invalidate();
      navigate(next ?? HOME_FOR_ROLE[me.role]);
    },
  });

  useEffect(() => {
    document.title = "Sign in · QueueSense";
  }, []);
  useEffect(() => {
    if (user && !login.isPending) navigate(next ?? HOME_FOR_ROLE[user.role]);
  }, [user, next, navigate, login.isPending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <BrandMark />
        <div>
          <h1>Sign in</h1>
          <p className="lede">
            Use the account issued by your campus administration.
          </p>
        </div>
        {!login.error && (notice || next) && (
          <p className="auth-note" role="status">
            {notice === "expired"
              ? "Your session expired. Sign in again; your tokens are safe on the server."
              : notice === "signed-out"
                ? "You're signed out. Your tokens stay in their queues."
                : "Sign in to continue."}
          </p>
        )}
        {login.error && (
          <div className="form-error" role="alert">
            {errorMessage(login.error)}
          </div>
        )}
        <Field label="Institutional email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </Field>
        <button
          className="button button-primary button-large button-full"
          disabled={login.isPending || !email || !password}
        >
          {login.isPending ? "Signing in…" : "Sign in"}{" "}
        </button>
        <div className="auth-links">
          <span>
            First time here or forgot your password?{" "}
            <Link href="/activate">Use an activation code</Link>
          </span>
        </div>
        <p className="auth-footnote">
          <LockKeyhole size={13} aria-hidden /> Staff accounts are created by
          administrators only.
        </p>
      </form>
    </main>
  );
}
