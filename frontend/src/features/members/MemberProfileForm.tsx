import { useState, type FormEvent } from "react";

export type PaymentMethod = "zelle" | "venmo" | "paypal" | "apple_cash";
export type MemberProfileInput = {
  displayName: string;
  phoneE164: string;
  paymentMethod: PaymentMethod;
  paymentIdentifier: string;
};

export function MemberProfileForm({
  mode,
  onSave,
  initialDisplayName = "",
  initialPhone = "",
  initialMethod = "venmo",
  busy = false,
}: {
  mode: "complete" | "edit";
  onSave: (input: MemberProfileInput) => Promise<void> | void;
  initialDisplayName?: string;
  initialPhone?: string;
  initialMethod?: PaymentMethod;
  busy?: boolean;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [phoneE164, setPhoneE164] = useState(initialPhone);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialMethod);
  const [paymentIdentifier, setPaymentIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({ displayName: displayName.trim(), phoneE164: phoneE164.trim(), paymentMethod, paymentIdentifier: paymentIdentifier.trim() });
      setPaymentIdentifier("");
    } catch {
      setError("We could not save your profile. Please try again.");
    }
  }

  return (
    <section className="card" aria-labelledby="profile-heading">
      <h1 id="profile-heading">{mode === "complete" ? "Complete your profile" : "Member profile"}</h1>
      <form onSubmit={submit}>
        <label>Display name<input required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>Phone number<input required type="tel" autoComplete="tel" pattern="\+[1-9][0-9]{7,14}" value={phoneE164} onChange={(event) => setPhoneE164(event.target.value)} /><small>Use international format, for example +14155550123.</small></label>
        <label>Preferred payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
          <option value="zelle">Zelle</option><option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="apple_cash">Apple Cash</option>
        </select></label>
        <label>Payment handle or account email<input required maxLength={254} autoComplete="off" value={paymentIdentifier} onChange={(event) => setPaymentIdentifier(event.target.value)} /></label>
        <p>Payment identifiers are encrypted. The app never sends money.</p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </section>
  );
}
