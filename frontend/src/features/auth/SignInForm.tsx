import { useState, type FormEvent } from "react";

export type AccessStatus = "approved_member" | "pending_request" | "new_request_created" | "duplicate_request";
export type Step = "identify" | "otp" | "request_sent" | "request_pending";

export type SignInFormProps = {
  checkAccess: (name: string, email: string) => Promise<{ status: AccessStatus }>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
};

export function SignInForm({
  checkAccess,
  sendOtp,
  verifyOtp,
  busy: externalBusy = false,
  error,
}: SignInFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<Step>("identify");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isBusy = externalBusy || busy;

  async function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      const result = await checkAccess(name.trim(), email.trim());
      if (result.status === "approved_member") {
        await sendOtp(email.trim());
        setStep("otp");
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
      </section>
    );
  }

  if (step === "request_pending") {
    return (
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h1 id="signin-heading">Request pending</h1>
        <p>Your access application is pending administrator approval. Check back after you receive a confirmation email.</p>
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
              pattern="[0-9]{6}"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
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
          }}
        >
          Use a different email
        </button>
      </section>
    );
  }

  return (
    <section className="card auth-card" aria-labelledby="signin-heading">
      <h1 id="signin-heading">Sign in to the Camping Club</h1>
      <p>Enter your name and email to sign in or request access.</p>
      <form onSubmit={(e) => void handleIdentify(e)}>
        <label>
          Name
          <input
            autoComplete="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Email address
          <input
            autoComplete="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {(error || localError) && <p role="alert">{error || localError}</p>}
        <button type="submit" disabled={isBusy}>{isBusy ? "Checking…" : "Continue"}</button>
      </form>
    </section>
  );
}
