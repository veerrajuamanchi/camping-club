import type { ReactNode } from "react";

export type MembershipState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "profileRequired" }
  | { status: "inactive" }
  | { status: "active"; role: "member" | "admin"; displayName: string };

export function AccessBoundary({
  state,
  requiredRole,
  onSignOut,
  children,
}: {
  state: MembershipState;
  requiredRole: "member" | "admin";
  onSignOut?: () => Promise<void> | void;
  children: ReactNode;
}) {
  if (state.status === "loading") return <p role="status">Checking club access…</p>;
  if (state.status === "signedOut") return <p>Sign in to continue.</p>;
  if (state.status === "profileRequired") return <p>Complete your invited profile to continue.</p>;
  if (state.status === "inactive") {
    return (
      <div className="card" style={{ maxWidth: "480px", margin: "2rem auto", textAlign: "center", padding: "2rem" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }} aria-hidden="true">🔒</div>
        <h2 style={{ fontSize: "1.3rem", color: "#111827", marginBottom: "0.5rem" }}>Club Access Inactive</h2>
        <p style={{ color: "#4b5563", marginBottom: "1.5rem" }}>
          Club access is inactive. Contact an administrator.
        </p>
        {onSignOut && (
          <button
            type="button"
            className="secondary-button"
            style={{ padding: "0.6rem 1.25rem", cursor: "pointer", width: "100%" }}
            onClick={() => void onSignOut()}
          >
            Sign Out & Return to Sign In
          </button>
        )}
      </div>
    );
  }
  if (requiredRole === "admin" && state.role !== "admin") return <p>Administrator access is required.</p>;
  return <>{children}</>;
}
