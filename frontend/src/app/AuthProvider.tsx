import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { invokeMemberApi, supabase, type ApiMember } from "../lib/supabase";
import type { MembershipState } from "../features/auth/AccessBoundary";

type AuthValue = {
  session: Session | null;
  membership: MembershipState;
  profile: ApiMember | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<MembershipState>({ status: "loading" });
  const [profile, setProfile] = useState<ApiMember | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) { setSession(null); setMembership({ status: "signedOut" }); return; }
    const { data: { session: current } } = await supabase.auth.getSession();
    setSession(current);
    if (!current) { setMembership({ status: "signedOut" }); setProfile(null); return; }
    try {
      const result = await invokeMemberApi<{ member: ApiMember }>("me");
      setProfile(result.member);
      setMembership({ status: "active", role: result.member.role, displayName: result.member.displayName });
    } catch {
      setProfile(null);
      setMembership({ status: "inactive" });
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
