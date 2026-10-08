import { useState } from "react";
import { useNavigate } from "react-router";
import type { MembershipState } from "./AccessBoundary";
import { SignInForm } from "./SignInForm";
import { pathAfterSignIn } from "./signInRouting";

export function SignInPage({
  authenticate,
  refresh,
}: {
  authenticate: (email: string, password: string) => Promise<void>;
  refresh: () => Promise<MembershipState>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function signIn(email: string, password: string) {
    setBusy(true);
    setError(null);
    let authenticated = false;
    try {
      await authenticate(email, password);
      authenticated = true;
      const membership = await refresh();
      navigate(pathAfterSignIn(membership), {
        replace: true,
        state: membership.status === "profileRequired" ? { passwordAlreadySet: true } : undefined,
      });
    } catch (signInError) {
      setError(authenticated
        ? "You are signed in, but we could not check your club profile. Refresh the page or contact an administrator."
        : "Email or password was not accepted.");
      throw signInError;
    } finally {
      setBusy(false);
    }
  }

  return <SignInForm onSignIn={signIn} busy={busy} error={error} />;
}
