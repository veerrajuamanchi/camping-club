import { useEffect, useState } from "react";

export type ConfirmGoingModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tripTitle: string;
  bundleVersion?: number | string;
  rules?: Array<{ stable_key: string; text: string }>;
  rulesMarkdown?: string | null;
  onConfirm: () => Promise<void>;
  busy?: boolean;
};

export function ConfirmGoingModal({
  isOpen,
  onClose,
  tripTitle,
  bundleVersion,
  rules,
  rulesMarkdown,
  onConfirm,
  busy = false,
}: ConfirmGoingModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAcknowledged(false);
      setErrorMsg(null);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen && !busy) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  async function handleConfirmClick() {
    if (!acknowledged) {
      setErrorMsg("Acknowledge the Camping Constitution before selecting Going.");
      return;
    }
    setErrorMsg(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: unknown) {
      setErrorMsg((err as Error)?.message || "Could not save your RSVP. Please try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-going-modal-title"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "560px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#ffffff",
          borderRadius: "14px",
          padding: 0,
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)",
          border: "1px solid #cbd5e1",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "1.1rem 1.4rem",
            borderBottom: "1px solid #e2e8f0",
            background: "#f0fdf4",
            borderTopLeftRadius: "13px",
            borderTopRightRadius: "13px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2
              id="confirm-going-modal-title"
              style={{
                margin: 0,
                fontSize: "1.15rem",
                fontWeight: 700,
                color: "#166534",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span>🏕️</span>
              <span>Join Trip: Accept Constitution</span>
            </h2>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.825rem", color: "#475569" }}>
              {tripTitle || "Camping Trip"}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "none",
              border: "none",
              fontSize: "1.4rem",
              lineHeight: 1,
              color: "#64748b",
              cursor: busy ? "not-allowed" : "pointer",
              padding: "0.25rem",
            }}
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: "1.25rem 1.4rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            fontSize: "0.925rem",
            color: "#334155",
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            By selecting Going you agree to the current Camping Constitution
            {bundleVersion != null ? ` (version ${bundleVersion})` : ""}.
          </p>

          {/* Constitution Summary or Rules Box */}
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "0.85rem 1rem",
              maxHeight: "180px",
              overflowY: "auto",
              fontSize: "0.85rem",
              lineHeight: 1.5,
              color: "#475569",
            }}
          >
            <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: "0.4rem" }}>
              📋 Camping Club Core Principles:
            </div>
            {rules && rules.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {rules.map((r) => (
                  <li key={r.stable_key} style={{ marginBottom: "0.35rem" }}>
                    <strong>{r.stable_key.replaceAll("-", " ")}:</strong> {r.text}
                  </li>
                ))}
              </ul>
            ) : rulesMarkdown ? (
              <div style={{ whiteSpace: "pre-line" }}>{rulesMarkdown}</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                <li>Leave no trace and maintain clean campsites at all times.</li>
                <li>Fulfill assigned chores and kitchen responsibilities promptly.</li>
                <li>Respect campsite quiet hours and fellow community members.</li>
                <li>Complete shared expense settlements per club policies.</li>
              </ul>
            )}
          </div>

          {/* Acknowledgment Checkbox Box */}
          <div
            style={{
              background: acknowledged ? "#f0fdf4" : "#fffbeb",
              border: `1.5px solid ${acknowledged ? "#86efac" : "#fcd34d"}`,
              padding: "0.85rem 1rem",
              borderRadius: "8px",
              transition: "all 0.15s ease",
            }}
          >
            <label
              className="checkbox-label"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.65rem",
                cursor: "pointer",
                margin: 0,
                fontWeight: 600,
                fontSize: "0.925rem",
                color: acknowledged ? "#166534" : "#92400e",
              }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => {
                  setAcknowledged(e.target.checked);
                  if (errorMsg) setErrorMsg(null);
                }}
                style={{
                  width: "1.25rem",
                  height: "1.25rem",
                  marginTop: "2px",
                  accentColor: "#16a34a",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              />
              <span>I have read and agree to the Camping Constitution.</span>
            </label>
          </div>

          {errorMsg && (
            <div
              role="alert"
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                padding: "0.6rem 0.85rem",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "0.9rem 1.4rem",
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc",
            borderBottomLeftRadius: "13px",
            borderBottomRightRadius: "13px",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
          }}
        >
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
            style={{ padding: "0.45rem 0.95rem", fontSize: "0.9rem" }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void handleConfirmClick()}
            style={{
              padding: "0.45rem 1.25rem",
              fontSize: "0.9rem",
              fontWeight: 700,
              background: "#16a34a",
              borderColor: "#15803d",
              color: "#ffffff",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Saving…" : "Confirm Going"}
          </button>
        </div>
      </div>
    </div>
  );
}
