import { useState } from "react";
import { supabase, invokeMemberApi } from "../../lib/supabase";
import { MemberProfileForm, type MemberProfileInput } from "../members/MemberProfileForm";

export function AcceptInvitation({ onComplete }: { onComplete: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function complete(input: MemberProfileInput) {
    if (!supabase) throw new Error("Supabase is not configured.");
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      throw new Error("A password is required");
    }
    setBusy(true);
    setError(null);
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) throw passwordError;
      await invokeMemberApi("complete_profile", input);
      await onComplete();
    } catch {
      setError("We could not complete the invitation. Reopen the invitation email or contact an administrator.");
      throw new Error("Invitation completion failed");
    } finally { setBusy(false); }
  }

  if (!supabase) return <p>Supabase is not configured.</p>;
  return <section className="stack">
    <div className="card">
      <h1>Accept club invitation</h1>
      <p>Your verified email invitation authorizes a single profile setup.</p>
      <label>Create password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
    </div>
    <MemberProfileForm mode="complete" onSave={complete} busy={busy} />
  </section>;
}
