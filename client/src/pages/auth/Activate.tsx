import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { KeyRound } from "lucide-react";
import { BrandMark } from "@/components/AppShell";
import { Field } from "@/components/ui/primitives";
import { HOME_FOR_ROLE } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc";

export default function Activate() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const activate = trpc.auth.activate.useMutation({
    onSuccess: me => {
      utils.auth.me.setData(undefined, me);
      navigate(HOME_FOR_ROLE[me.role]);
    },
  });
  useEffect(() => {
    document.title = "Activate account · QueueSense";
  }, []);

  const policyError =
    password &&
    (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
      ? "Use at least 10 characters with a letter and a number."
      : null;
  const mismatch =
    confirm && confirm !== password ? "Passwords don't match." : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (policyError || mismatch) return;
    activate.mutate({ email, code, password });
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <BrandMark />
        <div>
          <h1>Activate your account</h1>
          <p className="lede">
            Enter the one-time code from your administration office and choose a
            password. The same form resets a forgotten password.
          </p>
        </div>
        {activate.error && (
          <div className="form-error" role="alert">
            {errorMessage(activate.error)}
          </div>
        )}
        <Field label="Institutional email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Activation code"
          htmlFor="code"
          hint="Format XXXX-XXXX-XXXX · single use"
        >
          <input
            id="code"
            autoComplete="one-time-code"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH-JKMN"
            required
            spellCheck={false}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="password"
          error={policyError}
          hint="At least 10 characters, with a letter and a number"
        >
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={mismatch}>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />
        </Field>
        <button
          className="button button-primary button-large button-full"
          disabled={
            activate.isPending ||
            !email ||
            !code ||
            !password ||
            Boolean(policyError || mismatch) ||
            confirm !== password
          }
        >
          <KeyRound size={16} aria-hidden />{" "}
          {activate.isPending ? "Activating…" : "Activate and sign in"}
        </button>
        <div className="auth-links">
          <span>
            Already active? <Link href="/login">Sign in</Link>
          </span>
        </div>
      </form>
    </div>
  );
}
