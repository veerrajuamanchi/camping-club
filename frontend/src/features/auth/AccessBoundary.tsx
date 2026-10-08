import type { ReactNode } from "react";

export type MembershipState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "inactive" }
  | { status: "active"; role: "member" | "admin"; displayName: string };

export function AccessBoundary({
  state,
  requiredRole,
  children,
}: {
  state: MembershipState;
  requiredRole: "member" | "admin";
  children: ReactNode;
}) {
  if (state.status === "loading") return <p role="status">Checking club access…</p>;
  if (state.status === "signedOut") return <p>Sign in to continue.</p>;
  if (state.status === "inactive") return <p>Club access is inactive. Contact an administrator.</p>;
  if (requiredRole === "admin" && state.role !== "admin") return <p>Administrator access is required.</p>;
  return <>{children}</>;
}
