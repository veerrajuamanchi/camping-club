import { useState, type FormEvent } from "react";

export type AccessStatus =
  | "approved_member"
  | "pending_request"
  | "new_request_created"
  | "duplicate_request"
  | "not_registered";

export type AuthMode = "signin" | "register";
export type Step = "identify" | "otp" | "request_sent" | "request_pending";

export type SignInFormProps = {
  checkAccess: (name: string, email: string) => Promise<{ status: AccessStatus }>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
  initialMode?: AuthMode;
};

export function SignInForm({
  checkAccess,
  sendOtp,
  verifyOtp,
  busy: externalBusy = false,
  error,
  initialMode = "signin",
}: SignInFormProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<Step>("identify");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notRegisteredError, setNotRegisteredError] = useState(false);

  const isBusy = externalBusy || busy;

  function switchMode(newMode: AuthMode) {
    setMode(newMode);
    setLocalError(null);
    setNotRegisteredError(false);
  }

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setNotRegisteredError(false);
    setBusy(true);

    try {
      // In signin mode, name is empty. In register mode, name is submitted.
      const nameToSubmit = mode === "register" ? name.trim() : "";
      const result = await checkAccess(nameToSubmit, email.trim());

      if (result.status === "approved_member") {
        await sendOtp(email.trim());
        setStep("otp");
      } else if (result.status === "not_registered") {
        setNotRegisteredError(true);
        setLocalError("This email is not registered. Please register to request access.");
      } else if (result.status === "new_request_created") {
        setStep("request_sent");
      } else {
        // duplicate_request or pending_request
        setStep("request_pending");
      }
    } catch {
      setLocalError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      await verifyOtp(email.trim(), otp.trim());
    } catch {
      setLocalError("That code was not valid. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "request_sent") {
    return (
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h1 id="signin-heading">Access request submitted</h1>
        <p>Your request has been sent to the club administrator. You will receive an email when approved.</p>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setStep("identify");
            switchMode("signin");
            setEmail("");
            setName("");
          }}
        >
          Back to Sign In
        </button>
      </section>
    );
  }

  if (step === "request_pending") {
    return (
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h1 id="signin-heading">Request pending</h1>
        <p>Your access application is pending administrator approval. Check back after you receive a confirmation email.</p>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setStep("identify");
            switchMode("signin");
            setEmail("");
            setName("");
          }}
        >
          Back to Sign In
        </button>
      </section>
    );
  }

  if (step === "otp") {
    return (
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h1 id="signin-heading">Check your email</h1>
        <p>We sent a sign-in code to <strong>{email}</strong>. Enter it below.</p>
        <form onSubmit={(e) => void handleVerifyOtp(e)}>
          <label>
            Verification code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6,10}"
              required
              maxLength={10}
              value={otp}
              onChange={(e) => setOtp(e.target.value.trim())}
              placeholder="e.g. 12345678"
            />
          </label>
          {(error || localError) && <p role="alert">{error || localError}</p>}
          <button type="submit" disabled={isBusy}>{isBusy ? "Verifying…" : "Verify"}</button>
        </form>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setStep("identify");
            setOtp("");
            setLocalError(null);
            setNotRegisteredError(false);
          }}
        >
          Use a different email
        </button>
      </section>
    );
  }

  return (
    <section className="card auth-card" aria-labelledby="signin-heading">
      <div className="auth-tab-group" role="tablist" aria-label="Authentication modes">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          className={`auth-tab-btn ${mode === "signin" ? "active" : ""}`}
          onClick={() => switchMode("signin")}
        >
          Sign In
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className={`auth-tab-btn ${mode === "register" ? "active" : ""}`}
          onClick={() => switchMode("register")}
        >
          Register
        </button>
      </div>

      <h1 id="signin-heading">
        {mode === "signin" ? "Sign in to the Camping Club" : "Request Club Membership"}
      </h1>
      <p>
        {mode === "signin"
          ? "Enter your email to receive a secure sign-in code."
          : "Enter your name and email to request access from the club administrator."}
      </p>

      <form onSubmit={(e) => void handleIdentify(e)}>
        {mode === "register" && (
          <label>
            Name
            <input
              autoComplete="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          </label>
        )}
        <label>
          Email address
          <input
            autoComplete="email"
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (notRegisteredError) {
                setNotRegisteredError(false);
                setLocalError(null);
              }
            }}
            placeholder="you@example.com"
          />
        </label>

        {(error || localError) && (
          <div className="auth-error-block">
            <p role="alert">{error || localError}</p>
            {notRegisteredError && (
              <button
                type="button"
                className="link-button register-suggestion-btn"
                onClick={() => switchMode("register")}
              >
                Go to Registration &rarr;
              </button>
            )}
          </div>
        )}

        <button type="submit" disabled={isBusy}>
          {isBusy
            ? "Checking…"
            : mode === "signin"
            ? "Sign In"
            : "Request Access"}
        </button>
      </form>
    </section>
  );
}
