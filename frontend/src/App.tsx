import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "./app/AuthProvider";
import { AccessBoundary } from "./features/auth/AccessBoundary";
import { AcceptInvitation } from "./features/auth/AcceptInvitation";
import { SignInPage } from "./features/auth/SignInPage";
import { AdminMembersPage } from "./features/admin/AdminMembersPage";
import { MemberProfileForm, type MemberProfileInput } from "./features/members/MemberProfileForm";
import { TripCalendarPage } from "./features/trips/TripCalendarPage";
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

  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          Private Camping Club
        </Link>
        <nav>
          {membership.status === "active" && (
            <>
              <Link to="/">Trips</Link>
              <Link to="/profile">Profile</Link>
              {membership.role === "admin" && <Link to="/admin/members">Members</Link>}
              <button className="link-button" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          )}
        </nav>
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
