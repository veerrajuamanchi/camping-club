import type { MembershipState } from "./AccessBoundary";

export function pathAfterSignIn(state: MembershipState): string {
  return state.status === "profileRequired" ? "/accept-invitation" : "/";
}
