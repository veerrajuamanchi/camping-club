import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { useAuth } from "./AuthProvider";
import { AccessBoundary } from "../features/auth/AccessBoundary";
import { AcceptInvitation } from "../features/auth/AcceptInvitation";
import { SignInPage } from "../features/auth/SignInPage";
import { AdminMembersPage } from "../features/admin/AdminMembersPage";
import { AdminCampsitesPage } from "../features/admin/AdminCampsitesPage";
import { AdminScheduleDefaultsPage } from "../features/admin/AdminScheduleDefaultsPage";
import { AdminConstitutionPage } from "../features/admin/AdminConstitutionPage";
import { MasterResponsibilitiesPage } from "../features/admin/MasterResponsibilitiesPage";
import { MasterCatalogPage } from "../features/admin/MasterCatalogPage";
import { MemberProfileForm, type MemberProfileInput } from "../features/members/MemberProfileForm";
import { TripCalendarPage } from "../features/trips/TripCalendarPage";
import { EventDetailsPage } from "../features/trips/EventDetailsPage";
import { configurationError, invokeAuthApi, invokeMemberApi, supabase } from "../lib/supabase";

function LogoutRoute() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    void signOut().then(() => {
      navigate("/signin", { replace: true });
    });
  }, [signOut, navigate]);

  return <p role="status">Signing out…</p>;
}

function LoginRoute() {
  const { membership, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (membership.status === "inactive") {
      void signOut().then(() => {
        navigate("/signin", { replace: true });
      });
    } else if (membership.status === "active") {
      navigate("/", { replace: true });
    } else if (membership.status !== "loading") {
      navigate("/signin", { replace: true });
    }
  }, [membership.status, signOut, navigate]);

  return <p role="status">Redirecting to sign in…</p>;
}

function SignInRoute() {
  const { refresh } = useAuth();

  async function checkAccess(name: string, email: string) {
    const result = (await invokeAuthApi("check_access", { name, email })) as { status: string };
    return result as { status: "approved_member" | "pending_request" | "new_request_created" | "duplicate_request" | "not_registered" };
  }

  async function sendOtp(email: string) {
    if (!supabase) throw new Error("not configured");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
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

export function AppRoutes() {
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
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [globalSignOut, setGlobalSignOut] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (membership.status === "active" && membership.role === "admin") {
      void invokeMemberApi<{ requests: Array<unknown> }>("list_access_requests")
        .then((data) => setPendingRequestsCount(data.requests?.length || 0))
        .catch(() => {});
    }
  }, [membership]);

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
              style={{ position: "relative" }}
            >
              {profile?.displayName?.charAt(0).toUpperCase() || "👤"}
              {pendingRequestsCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    background: "#ef4444",
                    color: "#ffffff",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    borderRadius: "9999px",
                    minWidth: "16px",
                    height: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 4px",
                    border: "2px solid #ffffff",
                  }}
                  title={`${pendingRequestsCount} pending access request(s)`}
                >
                  {pendingRequestsCount}
                </span>
              )}
            </button>

            {userMenuOpen && (
              <div className="user-dropdown" onClick={() => setUserMenuOpen(false)}>
                <Link to="/profile">👤 My Profile</Link>
                {membership.role === "admin" && (
                  <>
                    <hr />
                    <Link to="/admin/campsites">🏕️ Campsite Directory</Link>
                    <Link to="/admin/members" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>👥 Members & Access</span>
                      {pendingRequestsCount > 0 && (
                        <span style={{ background: "#ef4444", color: "#ffffff", fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.45rem", borderRadius: "9999px" }}>
                          {pendingRequestsCount} new
                        </span>
                      )}
                    </Link>
                    <Link to="/admin/schedule-defaults">⚙️ Club Schedule Defaults</Link>
                    <Link to="/admin/constitution">📜 Camping Constitution</Link>
                    <Link to="/admin/responsibilities">🛠️ Master Responsibilities</Link>
                    <Link to="/admin/catalogs">📦 Master Catalogs</Link>
                  </>
                )}
                <hr />
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setShowSignOutModal(true);
                  }}
                >
                  🚪 Sign out
                </button>
              </div>
            )}
          </div>
        )}
        {membership.status === "inactive" && (
          <button
            type="button"
            className="secondary-button"
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", cursor: "pointer" }}
            onClick={() => {
              setShowSignOutModal(true);
            }}
          >
            🚪 Sign out
          </button>
        )}
      </header>
      {showSignOutModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sign-out-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: "1rem",
            backdropFilter: "blur(2px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !signingOut) setShowSignOutModal(false);
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              maxWidth: "420px",
              width: "100%",
              padding: "1.5rem",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div>
              <h2
                id="sign-out-modal-title"
                style={{
                  margin: "0 0 0.5rem",
                  fontSize: "1.25rem",
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <span>🚪</span> Confirm Sign Out
              </h2>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.92rem", lineHeight: 1.5 }}>
                Are you sure you want to sign out of <strong>Private Camping Club</strong>?
              </p>
            </div>

            <div
              style={{
                background: "#f8fafc",
                padding: "0.85rem",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.6rem",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  color: "#334155",
                }}
              >
                <input
                  type="checkbox"
                  checked={globalSignOut}
                  onChange={(e) => setGlobalSignOut(e.target.checked)}
                  style={{ marginTop: "0.15rem", width: "16px", height: "16px", cursor: "pointer" }}
                />
                <span>
                  <strong>Sign out of all devices & domains</strong>
                  <br />
                  <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                    Revokes active sessions across all devices (recommended for shared computers or switching domains).
                  </span>
                </span>
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.25rem" }}>
              <button
                type="button"
                className="secondary-button"
                disabled={signingOut}
                onClick={() => setShowSignOutModal(false)}
                style={{ minHeight: "44px", padding: "0.5rem 1rem", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true);
                  try {
                    await signOut({ scope: globalSignOut ? "global" : "local" });
                    setShowSignOutModal(false);
                    navigate("/signin", { replace: true });
                  } finally {
                    setSigningOut(false);
                  }
                }}
                style={{
                  minHeight: "44px",
                  padding: "0.5rem 1.25rem",
                  borderRadius: "6px",
                  backgroundColor: "#dc2626",
                  color: "#ffffff",
                  border: "none",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                {signingOut ? "Signing out…" : "Confirm Sign Out"}
              </button>
            </div>
          </div>
        </div>
      )}
      {membership.status === "active" && membership.role === "admin" && pendingRequestsCount > 0 && (
        <div
          style={{
            background: "#fef3c7",
            borderBottom: "1px solid #f59e0b",
            color: "#92400e",
            padding: "0.6rem 1.25rem",
            fontSize: "0.88rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <span>
            🔔 <strong>{pendingRequestsCount} new member access request{pendingRequestsCount > 1 ? "s" : ""}</strong> waiting for approval.
          </span>
          <Link
            to="/admin/members"
            style={{
              color: "#b45309",
              fontWeight: 700,
              textDecoration: "underline",
              marginLeft: "1rem",
            }}
          >
            Review & Approve →
          </Link>
        </div>
      )}
      <main className="container">
        <Routes>
          <Route path="/logout" element={<LogoutRoute />} />
          <Route path="/signout" element={<LogoutRoute />} />
          <Route path="/login" element={<LoginRoute />} />
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
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="member">
                  {null}
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/profile"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : (
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="member">
                  {profile && (
                    <MemberProfileForm
                      mode="edit"
                      initialDisplayName={profile.displayName}
                      initialPhone={profile.phoneE164}
                      initialMethod={profile.paymentMethod ?? "venmo"}
                      initialPaymentIdentifier={profile.paymentIdentifier ?? ""}
                      isAdmin={membership.status === "active" && membership.role === "admin"}
                      onSave={saveProfile}
                    />
                  )}
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/admin/members"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : (
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="admin">
                  <AdminMembersPage />
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/admin/campsites"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : (
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="admin">
                  <AdminCampsitesPage />
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/admin/schedule-defaults"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : (
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="admin">
                  <AdminScheduleDefaultsPage />
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/admin/constitution"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : (
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="admin">
                  <AdminConstitutionPage />
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/admin/responsibilities"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : (
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="admin">
                  <MasterResponsibilitiesPage />
                </AccessBoundary>
              )
            }
          />
          <Route
            path="/admin/catalogs"
            element={
              membership.status === "signedOut" ? (
                <Navigate to="/signin" replace />
              ) : (
                <AccessBoundary state={membership} onSignOut={() => void signOut().then(() => navigate("/signin", { replace: true }))} requiredRole="admin">
                  <MasterCatalogPage />
                </AccessBoundary>
              )
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
                <AccessBoundary state={membership} onSignOut={signOut} requiredRole="member">
                  <EventDetailsPage
                    isAdmin={membership.status === "active" && membership.role === "admin"}
                    userRole={membership.status === "active" ? membership.role : undefined}
                  />
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
                <AccessBoundary state={membership} onSignOut={signOut} requiredRole="member">
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
export default AppRoutes;
