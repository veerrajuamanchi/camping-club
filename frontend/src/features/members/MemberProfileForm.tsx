import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";

export type PaymentMethod = "zelle" | "venmo" | "paypal" | "apple_cash";

export type PaymentOptionItem = {
  id?: string;
  method: PaymentMethod;
  paymentIdentifier: string;
  preferred: boolean;
};

export type MemberProfileInput = {
  displayName: string;
  phoneE164: string;
  paymentMethod: PaymentMethod;
  paymentIdentifier: string;
  paymentMethods?: PaymentOptionItem[];
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

const ALL_METHODS: Array<{ value: PaymentMethod; label: string; icon: string; placeholder: string }> = [
  { value: "venmo", label: "Venmo", icon: "📱", placeholder: "@username (e.g. @JaneDoe)" },
  { value: "zelle", label: "Zelle", icon: "⚡", placeholder: "Phone or email (e.g. +14155550123)" },
  { value: "paypal", label: "PayPal", icon: "💳", placeholder: "paypal.me/handle (or email/username)" },
  { value: "apple_cash", label: "Apple Cash", icon: "🍎", placeholder: "Phone or Apple ID email" },
];

export function MemberProfileForm({
  mode,
  onSave,
  initialDisplayName = "",
  initialPhone = "",
  initialMethod = "venmo",
  initialPaymentIdentifier = "",
  initialPaymentMethods,
  busy = false,
  isAdmin = false,
}: {
  mode: "complete" | "edit";
  onSave: (input: MemberProfileInput) => Promise<void> | void;
  initialDisplayName?: string;
  initialPhone?: string;
  initialMethod?: PaymentMethod;
  initialPaymentIdentifier?: string;
  initialPaymentMethods?: PaymentOptionItem[];
  busy?: boolean;
  isAdmin?: boolean;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [phoneE164, setPhoneE164] = useState(initialPhone);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialMethod);
  const [paymentIdentifier, setPaymentIdentifier] = useState(initialPaymentIdentifier);

  // Multiple payment options state for edit mode
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptionItem[]>(() => {
    if (initialPaymentMethods && initialPaymentMethods.length > 0) {
      return initialPaymentMethods;
    }
    if (initialPaymentIdentifier) {
      return [{ method: initialMethod, paymentIdentifier: initialPaymentIdentifier, preferred: true }];
    }
    return [{ method: initialMethod, paymentIdentifier: "", preferred: true }];
  });

  const [addingMethod, setAddingMethod] = useState<PaymentMethod | "">("");
  const [newOptionHandle, setNewOptionHandle] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

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

  useEffect(() => {
    if (initialPaymentMethods && initialPaymentMethods.length > 0) {
      setPaymentOptions(initialPaymentMethods);
      const pref = initialPaymentMethods.find((p) => p.preferred) || initialPaymentMethods[0];
      setPaymentMethod(pref.method);
      setPaymentIdentifier(pref.paymentIdentifier);
    } else if (initialPaymentIdentifier) {
      setPaymentOptions([{ method: initialMethod, paymentIdentifier: initialPaymentIdentifier, preferred: true }]);
    }
  }, [initialPaymentMethods, initialPaymentIdentifier, initialMethod]);

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

  function handleSetPrimary(indexToSet: number) {
    setPaymentOptions((prev) =>
      prev.map((opt, idx) => ({
        ...opt,
        preferred: idx === indexToSet,
      }))
    );
    const selected = paymentOptions[indexToSet];
    if (selected) {
      setPaymentMethod(selected.method);
      setPaymentIdentifier(selected.paymentIdentifier);
    }
  }

  function handleRemoveOption(indexToRemove: number) {
    setPaymentOptions((prev) => {
      const remaining = prev.filter((_, idx) => idx !== indexToRemove);
      if (remaining.length > 0 && !remaining.some((opt) => opt.preferred)) {
        remaining[0].preferred = true;
        setPaymentMethod(remaining[0].method);
        setPaymentIdentifier(remaining[0].paymentIdentifier);
      }
      return remaining;
    });
  }

  function handleOptionIdentifierChange(index: number, newIdentifier: string) {
    setPaymentOptions((prev) =>
      prev.map((opt, idx) => {
        if (idx === index) {
          if (opt.preferred) {
            setPaymentIdentifier(newIdentifier);
          }
          return { ...opt, paymentIdentifier: newIdentifier };
        }
        return opt;
      })
    );
  }

  function handleAddOptionSubmit() {
    if (!addingMethod || !newOptionHandle.trim()) return;
    setPaymentOptions((prev) => [
      ...prev,
      {
        method: addingMethod,
        paymentIdentifier: newOptionHandle.trim(),
        preferred: false,
      },
    ]);
    setAddingMethod("");
    setNewOptionHandle("");
    setShowAddForm(false);
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

    const primaryOption = paymentOptions.find((p) => p.preferred) || paymentOptions[0];
    const finalMethod = primaryOption ? primaryOption.method : paymentMethod;
    const finalIdentifier = primaryOption ? primaryOption.paymentIdentifier.trim() : paymentIdentifier.trim();

    if (!finalIdentifier) {
      setError("Payment handle or account email is required.");
      return;
    }

    try {
      setSubmitting(true);
      const payload: MemberProfileInput = {
        displayName: displayName.trim(),
        phoneE164: cleanPhone,
        paymentMethod: finalMethod,
        paymentIdentifier: finalIdentifier,
      };

      if (paymentOptions.length > 1 || (initialPaymentMethods && initialPaymentMethods.length > 0)) {
        payload.paymentMethods = paymentOptions.map((opt) => ({
          id: opt.id,
          method: opt.method,
          paymentIdentifier: opt.paymentIdentifier.trim(),
          preferred: opt.preferred,
        }));
      }

      await onSave(payload);

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
  const configuredMethods = new Set(paymentOptions.map((p) => p.method));
  const availableMethodsToAdd = ALL_METHODS.filter((m) => !configuredMethods.has(m.value));

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

        {mode === "complete" ? (
          <>
            <label>
              Preferred payment method
              <select
                value={paymentMethod}
                onChange={(event) => {
                  const newMethod = event.target.value as PaymentMethod;
                  setPaymentMethod(newMethod);
                  setPaymentOptions([{ method: newMethod, paymentIdentifier, preferred: true }]);
                }}
              >
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
                onChange={(event) => {
                  setPaymentIdentifier(event.target.value);
                  setPaymentOptions([{ method: paymentMethod, paymentIdentifier: event.target.value, preferred: true }]);
                }}
              />
            </label>
          </>
        ) : (
          <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", color: "#0f172a" }}>Payment Options</h3>
                <small style={{ color: "#64748b" }}>
                  Set up payment methods for trip settlements. Your primary method is used for 1-click payment links, while others serve as fallbacks.
                </small>
              </div>
            </div>

            <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
              {paymentOptions.map((opt, idx) => {
                const methodMeta = ALL_METHODS.find((m) => m.value === opt.method) || {
                  label: opt.method,
                  icon: "💳",
                  placeholder: "Account handle or identifier",
                };
                return (
                  <div
                    key={`${opt.method}-${idx}`}
                    style={{
                      border: opt.preferred ? "2px solid #0284c7" : "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: "0.85rem",
                      background: opt.preferred ? "#f0f9ff" : "#ffffff",
                      position: "relative",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "1.1rem" }}>{methodMeta.icon}</span>
                        {opt.preferred ? (
                          <label style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                            <span style={{ display: "none" }}>Preferred payment method</span>
                            <select
                              aria-label="Preferred payment method"
                              value={opt.method}
                              onChange={(e) => {
                                const newMethod = e.target.value as PaymentMethod;
                                const updated = paymentOptions.map((o, i) =>
                                  i === idx ? { ...o, method: newMethod } : o
                                );
                                setPaymentOptions(updated);
                                setPaymentMethod(newMethod);
                              }}
                              style={{
                                padding: "0.2rem 0.4rem",
                                borderRadius: "6px",
                                border: "1.5px solid #0284c7",
                                fontWeight: 600,
                                fontSize: "0.9rem",
                                background: "#ffffff",
                                color: "#0f172a",
                              }}
                            >
                              <option value="venmo">Venmo</option>
                              <option value="zelle">Zelle</option>
                              <option value="paypal">PayPal</option>
                              <option value="apple_cash">Apple Cash</option>
                            </select>
                          </label>
                        ) : (
                          <strong style={{ fontSize: "0.95rem", color: "#0f172a" }}>{methodMeta.label}</strong>
                        )}
                        {opt.preferred ? (
                          <span style={{ background: "#0284c7", color: "#ffffff", fontSize: "0.72rem", padding: "0.15rem 0.5rem", borderRadius: "9999px", fontWeight: 700 }}>
                            ★ Primary / Preferred
                          </span>
                        ) : (
                          <span style={{ background: "#e2e8f0", color: "#475569", fontSize: "0.72rem", padding: "0.15rem 0.5rem", borderRadius: "9999px", fontWeight: 600 }}>
                            Fallback Option
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        {!opt.preferred && (
                          <button
                            type="button"
                            onClick={() => handleSetPrimary(idx)}
                            style={{
                              background: "#ffffff",
                              border: "1px solid #0284c7",
                              color: "#0284c7",
                              padding: "0.25rem 0.6rem",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            ⭐ Set as Primary
                          </button>
                        )}
                        {paymentOptions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(idx)}
                            style={{
                              background: "#fee2e2",
                              border: "1px solid #fca5a5",
                              color: "#991b1b",
                              padding: "0.25rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                            title="Remove payment option"
                          >
                            🗑️ Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: "0.82rem", color: "#475569" }}>
                        {opt.preferred ? "Payment handle or account email" : `${methodMeta.label} handle or phone`}
                      </span>
                      <input
                        required
                        aria-label={opt.preferred ? "Payment handle or account email" : `${methodMeta.label} handle or phone`}
                        maxLength={254}
                        autoComplete="off"
                        placeholder={methodMeta.placeholder}
                        value={opt.paymentIdentifier}
                        onChange={(e) => handleOptionIdentifierChange(idx, e.target.value)}
                        style={{ marginTop: "0.25rem" }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>

            {availableMethodsToAdd.length > 0 && !showAddForm && (
              <button
                type="button"
                onClick={() => {
                  setAddingMethod(availableMethodsToAdd[0].value);
                  setShowAddForm(true);
                }}
                style={{
                  marginTop: "0.85rem",
                  background: "#f8fafc",
                  border: "1px dashed #94a3b8",
                  color: "#334155",
                  padding: "0.5rem 1rem",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                ➕ Add Another Payment Option
              </button>
            )}

            {showAddForm && (
              <div
                style={{
                  marginTop: "0.85rem",
                  border: "1px dashed #0284c7",
                  background: "#f8fafc",
                  padding: "0.85rem",
                  borderRadius: "8px",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#0f172a", marginBottom: "0.5rem" }}>
                  Add Payment Method
                </div>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <label>
                    <span style={{ fontSize: "0.82rem", color: "#475569" }}>Select Method</span>
                    <select
                      value={addingMethod}
                      onChange={(e) => setAddingMethod(e.target.value as PaymentMethod)}
                      style={{ marginTop: "0.25rem" }}
                    >
                      {availableMethodsToAdd.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.icon} {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span style={{ fontSize: "0.82rem", color: "#475569" }}>
                      Handle, Phone number, or Account email
                    </span>
                    <input
                      placeholder={ALL_METHODS.find((m) => m.value === addingMethod)?.placeholder || "Account identifier"}
                      value={newOptionHandle}
                      onChange={(e) => setNewOptionHandle(e.target.value)}
                      style={{ marginTop: "0.25rem" }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <button
                      type="button"
                      onClick={handleAddOptionSubmit}
                      disabled={!newOptionHandle.trim()}
                      style={{
                        background: "#0284c7",
                        color: "#fff",
                        border: "none",
                        padding: "0.4rem 0.85rem",
                        borderRadius: "6px",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                        cursor: newOptionHandle.trim() ? "pointer" : "not-allowed",
                      }}
                    >
                      Add Option
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setNewOptionHandle("");
                      }}
                      style={{
                        background: "none",
                        border: "1px solid #cbd5e1",
                        padding: "0.4rem 0.85rem",
                        borderRadius: "6px",
                        fontSize: "0.82rem",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

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
