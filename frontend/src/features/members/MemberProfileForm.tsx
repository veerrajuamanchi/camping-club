import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";

export type PaymentMethod = "zelle" | "venmo" | "paypal" | "apple_cash";
export type MemberProfileInput = {
  displayName: string;
  phoneE164: string;
  paymentMethod: PaymentMethod;
  paymentIdentifier: string;
};

export function normalizePhoneE164(raw: string): { normalized: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { normalized: "", error: "Phone number is required." };
  }

  // If already strict E.164: + followed by 8 to 15 digits
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    return { normalized: trimmed };
  }

  // Strip common phone formatting characters: spaces, dashes, parentheses, dots
  const stripped = trimmed.replace(/[\s\-().]/g, "");

  // If after stripping punctuation it is strict E.164
  if (/^\+[1-9]\d{7,14}$/.test(stripped)) {
    return { normalized: stripped };
  }

  // If user entered 10 digits without country code (standard North American NANP number)
  if (/^[2-9]\d{9}$/.test(stripped)) {
    return { normalized: `+1${stripped}` };
  }

  // If user entered 11 digits starting with 1 without '+' (US/Canada with country code 1)
  if (/^1[2-9]\d{9}$/.test(stripped)) {
    return { normalized: `+${stripped}` };
  }

  return {
    normalized: stripped,
    error: "Phone number must be in international format (e.g. +14155550123). Please include '+' and your country code without spaces or dashes.",
  };
}

export function MemberProfileForm({
  mode,
  onSave,
  initialDisplayName = "",
  initialPhone = "",
  initialMethod = "venmo",
  initialPaymentIdentifier = "",
  busy = false,
  isAdmin = false,
}: {
  mode: "complete" | "edit";
  onSave: (input: MemberProfileInput) => Promise<void> | void;
  initialDisplayName?: string;
  initialPhone?: string;
  initialMethod?: PaymentMethod;
  initialPaymentIdentifier?: string;
  busy?: boolean;
  isAdmin?: boolean;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [phoneE164, setPhoneE164] = useState(initialPhone);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialMethod);
  const [paymentIdentifier, setPaymentIdentifier] = useState(initialPaymentIdentifier);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDisplayName(initialDisplayName);
  }, [initialDisplayName]);

  useEffect(() => {
    setPhoneE164(initialPhone);
  }, [initialPhone]);

  useEffect(() => {
    setPaymentMethod(initialMethod);
  }, [initialMethod]);

  useEffect(() => {
    setPaymentIdentifier(initialPaymentIdentifier);
  }, [initialPaymentIdentifier]);

  function handlePhoneBlur() {
    if (!phoneE164.trim()) return;
    const result = normalizePhoneE164(phoneE164);
    if (!result.error) {
      setPhoneE164(result.normalized);
      setPhoneError(null);
    } else {
      setPhoneError(result.error);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPhoneError(null);
    setSavedMessage(null);

    const phoneResult = normalizePhoneE164(phoneE164);
    if (phoneResult.error) {
      setPhoneError(phoneResult.error);
      return;
    }
    const cleanPhone = phoneResult.normalized;
    setPhoneE164(cleanPhone);

    try {
      setSubmitting(true);
      await onSave({
        displayName: displayName.trim(),
        phoneE164: cleanPhone,
        paymentMethod,
        paymentIdentifier: paymentIdentifier.trim(),
      });
      if (mode === "complete") {
        setPaymentIdentifier("");
      } else {
        setSavedMessage("Profile updated successfully!");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("phone") || msg.toLowerCase().includes("invalid_request")) {
        setError("We could not save your profile. Please check that your phone number is in international format (e.g. +14155550123) and all fields are complete.");
      } else {
        setError("We could not save your profile. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isSaving = busy || submitting;

  return (
    <section className="card" aria-labelledby="profile-heading">
      <h1 id="profile-heading">{mode === "complete" ? "Complete your profile" : "Member profile"}</h1>
      <form onSubmit={submit} noValidate>
        <label>
          Display name
          <input
            required
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          Phone number
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#166534", marginLeft: "0.5rem" }}>
            (International format required, e.g. +14155550123)
          </span>
          <input
            required
            type="tel"
            autoComplete="tel"
            placeholder="+14155550123"
            value={phoneE164}
            onChange={(event) => {
              setPhoneE164(event.target.value);
              if (phoneError) setPhoneError(null);
            }}
            onBlur={handlePhoneBlur}
            style={phoneError ? { borderColor: "#dc2626", backgroundColor: "#fff5f5" } : undefined}
          />
          {phoneError ? (
            <span role="alert" className="form-error" style={{ display: "block", color: "#dc2626", fontWeight: 600, marginTop: "0.25rem", fontSize: "0.85rem" }}>
              {phoneError}
            </span>
          ) : (
            <small style={{ display: "block", color: "#4b5563", marginTop: "0.25rem", fontSize: "0.82rem" }}>
              Must start with <strong>+</strong> and country code (e.g. <strong>+14155550123</strong> for US/Canada). Spaces, parentheses, and dashes are automatically formatted.
            </small>
          )}
        </label>
        <label>
          Preferred payment method
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
            <option value="zelle">Zelle</option>
            <option value="venmo">Venmo</option>
            <option value="paypal">PayPal</option>
            <option value="apple_cash">Apple Cash</option>
          </select>
        </label>
        <label>
          Payment handle or account email
          <input
            required
            maxLength={254}
            autoComplete="off"
            value={paymentIdentifier}
            onChange={(event) => setPaymentIdentifier(event.target.value)}
          />
        </label>
        <p>Payment identifiers are encrypted. The app never sends money.</p>
        {savedMessage && (
          <p role="status" style={{ color: "#166534", backgroundColor: "#f0fdf4", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #bbf7d0", fontSize: "0.9rem" }}>
            {savedMessage}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save profile"}</button>
      </form>
      {isAdmin && (
        <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid #e2e8f0" }}>
          <p style={{ fontWeight: 600, margin: "0 0 0.5rem 0", fontSize: "0.9rem" }}>Administrator Tools</p>
          <Link to="/admin/catalogs" style={{ color: "#1c2d24", fontWeight: 600, fontSize: "0.9rem", textDecoration: "underline" }}>
            📦 Manage Master Catalogs (Gear, Food, Duties) →
          </Link>
        </div>
      )}
    </section>
  );
}
