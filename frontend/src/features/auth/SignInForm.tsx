import { useState, type FormEvent } from "react";

type SignInFormProps = {
  onSignIn: (email: string, password: string) => Promise<void> | void;
  busy?: boolean;
  error?: string | null;
};

export function SignInForm({ onSignIn, busy = false, error }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    try {
      await onSignIn(email.trim(), password);
    } catch {
      setLocalError("We could not sign you in. Check your details or ask an administrator for help.");
    }
  }

  return (
    <section className="card auth-card" aria-labelledby="signin-heading">
      <h1 id="signin-heading">Member sign in</h1>
      <p>Membership is by invitation only. Ask a club administrator if you need an invitation.</p>
      <form onSubmit={submit}>
        <label>
          Email address
          <input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {(error || localError) && <p role="alert">{error || localError}</p>}
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  );
}
