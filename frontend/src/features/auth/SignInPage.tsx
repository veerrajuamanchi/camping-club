import { useState } from "react";
import { useNavigate } from "react-router";
import type { MembershipState } from "./AccessBoundary";
import { SignInForm, type AccessStatus } from "./SignInForm";
import { pathAfterSignIn } from "./signInRouting";

type SignInPageProps = {
  checkAccess: (name: string, email: string) => Promise<{ status: AccessStatus }>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  refresh: () => Promise<MembershipState>;
};

export function SignInPage({
  checkAccess,
  sendOtp,
  verifyOtp,
  refresh,
}: SignInPageProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleVerify(email: string, token: string) {
    setBusy(true);
    setError(null);
    let verified = false;
    try {
      await verifyOtp(email, token);
      verified = true;
      const membership = await refresh();
      navigate(pathAfterSignIn(membership), { replace: true });
    } catch (verifyError) {
      setError(
        verified
          ? "You are signed in, but we could not check your club profile. Refresh the page or contact an administrator."
          : "That code was not valid. Check the code and try again.",
      );
      throw verifyError;
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInForm
      checkAccess={checkAccess}
      sendOtp={sendOtp}
      verifyOtp={handleVerify}
      busy={busy}
      error={error}
    />
  );
}
