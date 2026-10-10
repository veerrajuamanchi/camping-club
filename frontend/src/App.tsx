import { useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "./app/AuthProvider";
import { AccessBoundary } from "./features/auth/AccessBoundary";
import { AcceptInvitation } from "./features/auth/AcceptInvitation";
import { SignInPage } from "./features/auth/SignInPage";
import { AdminMembersPage } from "./features/admin/AdminMembersPage";
import { AdminCampsitesPage } from "./features/admin/AdminCampsitesPage";
import { MemberProfileForm, type MemberProfileInput } from "./features/members/MemberProfileForm";
import { TripCalendarPage } from "./features/trips/TripCalendarPage";
import { EventDetailsPage } from "./features/trips/EventDetailsPage";
import { configurationError, invokeAuthApi, invokeMemberApi, supabase } from "./lib/supabase";

function SignInRoute() {
  const { refresh } = useAuth();

  async function checkAccess(name: string, email: string) {
    const result = (await invokeAuthApi("check_access", { name, email })) as { status: string };
    return result as { status: "approved_member" | "pending_request" | "new_request_created" | "duplicate_request" };
  }

  async function sendOtp(email: string) {
    if (!supabase) throw new Error("not configured");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
  }

  async function verifyOtp(email: string, token: string) {
    if (!supabase) throw new Error("not configured");
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
    await refresh();
  }

  return <SignInPage checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={verifyOtp} refresh={refresh} />;
}

function AppRoutes() {
  const { membership, profile, refresh, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  if (configurationError)
    return (
      <main className="container">
        <p role="alert">{configurationError}</p>
        <p>Copy frontend/.env.example to frontend/.env.local and use the local Supabase public project values.</p>
      </main>
    );

  async function saveProfile(input: MemberProfileInput) {
    await invokeMemberApi("update_profile", input);
    await refresh();
  }
  async function completeInvitation() {
    await refresh();
    navigate("/", { replace: true });
  }

  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand-container">
          <div className="brand-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m19 20-7-14-7 14" />
              <path d="M12 6v14" />
              <path d="m4.5 15 7.5 5 7.5-5" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">Private Camping Club</h1>
            <p className="brand-slogan">Plan together. Camp together.</p>
          </div>
        </Link>

        {membership.status === "active" && (
          <div className="user-menu-wrapper">
            <button
              type="button"
              className="user-avatar-btn"
              aria-label="User menu"
              onClick={() => setUserMenuOpen((open: boolean) => !open)}
            >
              {profile?.displayName?.charAt(0).toUpperCase() || "👤"}
            </button>

            {userMenuOpen && (
              <div className="user-dropdown" onClick={() => setUserMenuOpen(false)}>
                <Link to="/profile">👤 My Profile</Link>
                {membership.role === "admin" && (
                  <>
                    <hr />
                    <Link to="/admin/campsites">🏕️ Campsite Directory</Link>
                    <Link to="/admin/members">👥 Members & Access</Link>
                  </>
                )}
                <hr />
                <button type="button" onClick={() => void signOut()}>
                  🚪 Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      <main className="container">
        <Routes>
          <Route
            path="/signin"
            element={membership.status === "active" ? <Navigate to="/" replace /> : <SignInRoute />}
          />
          <Route
            path="/accept-invitation"
            element={
              membership.status === "active" ? (
                <Navigate to="/" replace />
              ) : membership.status === "loading" ? (
                <p role="status">Verifying…</p>
              ) : membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : membership.status === "profileRequired" ? (
                <AcceptInvitation onComplete={completeInvitation} />
              ) : (
                <AccessBoundary state={membership} requiredRole="member">
                  {null}
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/profile"
            element={
              <AccessBoundary state={membership} requiredRole="member">
                {profile && (
                  <MemberProfileForm
                    mode="edit"
                    initialDisplayName={profile.displayName}
                    initialPhone={profile.phoneE164}
                    initialMethod={profile.paymentMethod ?? "venmo"}
                    onSave={saveProfile}
                  />
                )}
              </AccessBoundary>
            }
          />
          <Route
            path="/admin/members"
            element={
              <AccessBoundary state={membership} requiredRole="admin">
                <AdminMembersPage />
              </AccessBoundary>
            }
          />
          <Route
            path="/admin/campsites"
            element={
              <AccessBoundary state={membership} requiredRole="admin">
                <AdminCampsitesPage />
              </AccessBoundary>
            }
          />
          <Route
            path="/trips/:tripId"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : membership.status === "profileRequired" ? (
                <Navigate to="/accept-invitation" replace />
              ) : (
                <AccessBoundary state={membership} requiredRole="member">
                  <EventDetailsPage isAdmin={membership.status === "active" && membership.role === "admin"} />
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : membership.status === "profileRequired" ? (
                <Navigate to="/accept-invitation" replace />
              ) : (
                <AccessBoundary state={membership} requiredRole="member">
                  <TripCalendarPage isAdmin={membership.status === "active" && membership.role === "admin"} />
                </AccessBoundary>
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace state={{ from: location.pathname }} />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
