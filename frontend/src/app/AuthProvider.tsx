import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { invokeMemberApi, MemberApiError, supabase, type ApiMember } from "../lib/supabase";
import type { MembershipState } from "../features/auth/AccessBoundary";

type AuthValue = {
  session: Session | null;
  membership: MembershipState;
  profile: ApiMember | null;
  refresh: () => Promise<MembershipState>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<MembershipState>({ status: "loading" });
  const [profile, setProfile] = useState<ApiMember | null>(null);

  const refresh = useCallback(async (): Promise<MembershipState> => {
    if (!supabase) { setSession(null); setMembership({ status: "signedOut" }); return { status: "signedOut" }; }
    const { data: { session: current } } = await supabase.auth.getSession();
    setSession(current);
    if (!current) { const state = { status: "signedOut" } as const; setMembership(state); setProfile(null); return state; }
    try {
      const result = await invokeMemberApi<{ member: ApiMember }>("me");
      setProfile(result.member);
      const state = { status: "active", role: result.member.role, displayName: result.member.displayName } as const;
      setMembership(state);
      return state;
    } catch (error) {
      setProfile(null);
      const state = error instanceof MemberApiError && error.code === "invitation_profile_required"
        ? { status: "profileRequired" } as const
        : { status: "inactive" } as const;
      setMembership(state);
      return state;
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setMembership({ status: "signedOut" }); return; }
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session); void refresh(); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      queueMicrotask(() => { if (alive) void refresh(); });
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [refresh]);

  const value = useMemo<AuthValue>(() => ({
    session, membership, profile, refresh,
    signOut: async () => { if (supabase) await supabase.auth.signOut(); setProfile(null); setMembership({ status: "signedOut" }); },
  }), [session, membership, profile, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth requires AuthProvider");
  return value;
}
