import { useEffect, useState, type FormEvent } from "react";
import { invokeMemberApi } from "../../lib/supabase";

type MemberRow = { member_id: string; display_name: string; member_role: "member" | "admin" | "accountant"; account_status: "active" | "inactive" | "suspended"; created_at: string };
type AccessRequest = { id: string; display_name: string; email?: string | null; created_at: string };

export function AccessRequestsSection() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void invokeMemberApi<{ requests: AccessRequest[] }>("list_access_requests")
      .then((data) => setRequests(data.requests))
      .catch(() => setMessage("Could not load access requests."));
  }, []);

  async function resolve(id: string, action: "approve" | "reject") {
    setBusy(true);
    setMessage(null);
    try {
      await invokeMemberApi(
        action === "approve" ? "approve_access_request" : "reject_access_request",
        { requestId: id }
      );
      setRequests((prev) => prev.filter((r) => r.id !== id));
      setMessage(action === "approve" ? "Request approved and invitation email sent." : "Request rejected.");
    } catch {
      setMessage("Could not process request. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (requests.length === 0 && !message) return null;

  return (
    <section className="card" aria-labelledby="access-requests-heading">
      <h2 id="access-requests-heading">Access requests</h2>
      {message && <p role="status">{message}</p>}
      {requests.length === 0 && <p>No pending requests.</p>}
      <ul className="admin-participant-list">
        {requests.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{r.display_name}</strong>
              {r.email ? ` (${r.email})` : ""} · {new Date(r.created_at).toLocaleDateString()}
            </span>
            <div>
              <button type="button" disabled={busy} onClick={() => void resolve(r.id, "approve")}>Approve</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void resolve(r.id, "reject")}>Reject</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AdminMembersPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await invokeMemberApi<{ members: MemberRow[] }>("list_members");
    setMembers(response.members);
  };
  useEffect(() => { void load().catch(() => setNotice("Could not load members.")); }, []);

  async function invite(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      await invokeMemberApi("invite_member", { email });
      setEmail("");
      setNotice("Invitation sent.");
    } catch (err: any) {
      const errStr = String(err?.message ?? err?.code ?? "").toLowerCase();
      if (errStr.includes("already") || errStr.includes("exists") || err?.status === 409) {
        setNotice("This member already exists.");
      } else {
        setNotice("Invitation could not be sent.");
      }
    } finally {
      setBusy(false);
    }
  }
  async function update(row: MemberRow, field: "memberRole" | "accountStatus", value: string) {
    const input = { memberId: row.member_id, memberRole: field === "memberRole" ? value : row.member_role, accountStatus: field === "accountStatus" ? value : row.account_status, reason: "Administrator membership maintenance" };
    setBusy(true);
    try {
      await invokeMemberApi("update_membership", input);
      await load();
      if (field === "memberRole") {
        const roleLabel = value === "admin" ? "an Administrator" : value === "accountant" ? "an Accountant" : "a Member";
        setNotice(`Role updated: ${row.display_name} is now ${roleLabel}. Change recorded in audit log.`);
      } else {
        setNotice(`Access status updated: ${row.display_name} is now ${value}.`);
      }
    } catch {
      setNotice("Membership could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="stack">
    <AccessRequestsSection />
    <div className="card"><h1>Administrator · Members</h1><p>Role and access changes are performed and audited by the server.</p>
      <form onSubmit={invite} className="inline-form"><label>Invite by email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><button disabled={busy}>Send invitation</button></form>
    </div>
    {notice && <p role="status">{notice}</p>}
    <div className="card"><h2>Club members</h2><div className="member-list">{members.map((row) => <article className="member-row" key={row.member_id}>
      <div><strong>{row.display_name}</strong> <span style={{ color: "#94a3b8", margin: "0 6px" }}>·</span> <span className="badge-pill" style={{ textTransform: "capitalize", fontSize: "0.8rem", backgroundColor: row.member_role === "accountant" ? "#065f46" : undefined, color: row.member_role === "accountant" ? "#a7f3d0" : undefined }}>{row.member_role}</span></div>
      <label>Access<select disabled={busy} value={row.account_status} onChange={(event) => void update(row, "accountStatus", event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></label>
      <label>Role<select disabled={busy} value={row.member_role} onChange={(event) => void update(row, "memberRole", event.target.value)}><option value="member">Member</option><option value="admin">Administrator</option><option value="accountant">Accountant</option></select></label>
    </article>)}</div></div>
  </section>;
}
