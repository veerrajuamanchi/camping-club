import { useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "./app/AuthProvider";
import { AccessBoundary } from "./features/auth/AccessBoundary";
import { AcceptInvitation } from "./features/auth/AcceptInvitation";
import { SignInForm } from "./features/auth/SignInForm";
import { AdminMembersPage } from "./features/admin/AdminMembersPage";
import { MemberProfileForm, type MemberProfileInput } from "./features/members/MemberProfileForm";
import { TripCalendarPage } from "./features/trips/TripCalendarPage";
import { configurationError, invokeMemberApi, supabase } from "./lib/supabase";

function SignInPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error("not configured");
    setBusy(true); setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError("Email or password was not accepted."); throw authError; }
    } catch (authError) {
      setError("Email or password was not accepted.");
      throw authError;
    } finally { setBusy(false); }
  }
  return <SignInForm onSignIn={signIn} busy={busy} error={error} />;
}

function AppRoutes() {
  const { membership, profile, refresh, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  if (configurationError) return <main className="container"><p role="alert">{configurationError}</p><p>Copy frontend/.env.example to frontend/.env.local and use the local Supabase public project values.</p></main>;

  async function saveProfile(input: MemberProfileInput) { await invokeMemberApi("update_profile", input); await refresh(); }
  async function completeInvitation() { await refresh(); navigate("/", { replace: true }); }

  return <>
    <header className="site-header"><Link to="/" className="brand">Private Camping Club</Link><nav>
      {membership.status === "active" && <><Link to="/">Trips</Link><Link to="/profile">Profile</Link>{membership.role === "admin" && <Link to="/admin/members">Members</Link>}<button className="link-button" onClick={() => void signOut()}>Sign out</button></>}
    </nav></header>
    <main className="container"><Routes>
      <Route path="/signin" element={membership.status === "active" ? <Navigate to="/" replace /> : <SignInPage />} />
      <Route path="/accept-invitation" element={membership.status === "active" ? <Navigate to="/" replace /> : membership.status === "loading" ? <p role="status">Verifying invitation…</p> : membership.status === "signedOut" ? <p>Open the invitation link from your email to accept it.</p> : <AcceptInvitation onComplete={completeInvitation} />} />
      <Route path="/profile" element={<AccessBoundary state={membership} requiredRole="member">{profile && <MemberProfileForm mode="edit" initialDisplayName={profile.displayName} initialPhone={profile.phoneE164} initialMethod={profile.paymentMethod ?? "venmo"} onSave={saveProfile} />}</AccessBoundary>} />
      <Route path="/admin/members" element={<AccessBoundary state={membership} requiredRole="admin"><AdminMembersPage /></AccessBoundary>} />
      <Route path="/" element={membership.status === "signedOut" ? <Navigate to="/signin" replace /> : <AccessBoundary state={membership} requiredRole="member"><TripCalendarPage isAdmin={membership.status === "active" && membership.role === "admin"} /></AccessBoundary>} />
      <Route path="*" element={<Navigate to="/" replace state={{ from: location.pathname }} />} />
    </Routes></main>
  </>;
}

export default function App() { return <BrowserRouter><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>; }
