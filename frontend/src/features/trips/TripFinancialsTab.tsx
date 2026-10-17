import React, { useEffect, useState } from "react";
import type { TripApiType } from "./EventDetailsPage";

export type ExpenseAllocation = {
  memberId: string;
  memberName: string;
  allocatedCents: number;
  isMe: boolean;
};

export type TripExpense = {
  id: string;
  expenseType: "cabin_deposit" | "carpool_mileage" | "shared_receipt" | "other";
  payerMemberId: string;
  payerName: string;
  amountCents: number;
  description: string;
  incurredDate: string;
  receiptUrl: string | null;
  isLocked: boolean;
  allocations: ExpenseAllocation[];
};

export type CarpoolReimbursement = {
  carpoolId: string;
  driverMemberId: string;
  driverName: string;
  vehicleDescription: string;
  milesDriven: number;
  amountCents: number;
  occupantCount: number;
  occupantNames: string[];
  allocations: ExpenseAllocation[];
};

export type CabinDepositObligation = {
  payerMemberId: string;
  payerName: string;
  depositPerPersonCents: number;
  confirmedCount: number;
  amountCents: number;
  allocations: ExpenseAllocation[];
};

export type SettlementRun = {
  id: string | null;
  versionNo: number;
  status: "draft" | "finalized" | "settled" | "superseded";
  totalExpensesCents: number;
  algorithmUsed: "exact" | "greedy_fallback";
  finalizedAt: string | null;
  settledAt: string | null;
};

export type SettlementBalance = {
  memberId: string;
  displayName: string;
  totalPaidCents: number;
  totalAllocatedCents: number;
  netBalanceCents: number;
  isMe: boolean;
};

export type SettlementTransfer = {
  id: string;
  payerMemberId: string;
  payerName: string;
  recipientMemberId: string;
  recipientName: string;
  amountCents: number;
  status: "outstanding" | "sent" | "confirmed";
  markedSentAt: string | null;
  confirmedReceivedAt: string | null;
  paymentMethod: string | null;
  recipientPreferredMethod: string;
  notes: string | null;
  isPayer: boolean;
  isRecipient: boolean;
};

export type TripFinancialsData = {
  tripId: string;
  expenses: TripExpense[];
  carpoolReimbursements: CarpoolReimbursement[];
  cabinDeposit: CabinDepositObligation | null;
  settlementRun: SettlementRun | null;
  balances: SettlementBalance[];
  transfers: SettlementTransfer[];
  isFinalized: boolean;
};

type Props = {
  tripId: string;
  isAdmin: boolean;
  isConfirmedAttendee: boolean;
  currentMemberId?: string;
  confirmedAttendees?: Array<{ memberId: string; displayName: string }>;
  tripStatus?: string;
  api: TripApiType;
  onStatusChange?: () => void;
};

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export function TripFinancialsTab({
  tripId,
  isAdmin,
  isConfirmedAttendee,
  currentMemberId,
  confirmedAttendees = [],
  tripStatus,
  api,
  onStatusChange,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TripFinancialsData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Add Expense Modal
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [desc, setDesc] = useState("");
  const [payerId, setPayerId] = useState(currentMemberId ?? (confirmedAttendees[0]?.memberId || ""));
  const [amountStr, setAmountStr] = useState("");
  const [incurredDate, setIncurredDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptUrl, setReceiptUrl] = useState("");

  // Mark Sent Modal
  const [showMarkSentModal, setShowMarkSentModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<SettlementTransfer | null>(null);
  const [transferMethod, setTransferMethod] = useState("zelle");
  const [transferNotes, setTransferNotes] = useState("");

  // Finalize Confirmation Modal
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  const fetchFinancials = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await api<TripFinancialsData>("get_trip_financials", { tripId });
      setData(res);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load trip financials.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinancials();
  }, [tripId]);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const dollars = parseFloat(amountStr);
    if (isNaN(dollars) || dollars <= 0) {
      setErrorMsg("Please enter a valid expense amount greater than $0.00.");
      return;
    }
    const amountCents = Math.round(dollars * 100);

    // Split equally among confirmed attendees
    const n = confirmedAttendees.length;
    if (n === 0) {
      setErrorMsg("Cannot create expense: No confirmed attendees found.");
      return;
    }
    const base = Math.floor(amountCents / n);
    const rem = amountCents % n;
    const allocations = confirmedAttendees.map((att, idx) => ({
      memberId: att.memberId,
      allocatedCents: idx < rem ? base + 1 : base,
    }));

    try {
      setActionBusy(true);
      setErrorMsg(null);
      await api("admin_manage_trip_expense", {
        tripId,
        action: "create",
        expenseType: "shared_receipt",
        payerMemberId: payerId || currentMemberId,
        amountCents,
        description: desc.trim(),
        incurredDate,
        receiptUrl: receiptUrl.trim() || undefined,
        allocations,
      });
      setShowAddExpenseModal(false);
      setDesc("");
      setAmountStr("");
      setReceiptUrl("");
      await fetchFinancials();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to record expense.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!window.confirm("Are you sure you want to delete this shared expense?")) return;
    try {
      setActionBusy(true);
      setErrorMsg(null);
      await api("admin_manage_trip_expense", {
        tripId,
        action: "delete",
        expenseId,
      });
      await fetchFinancials();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete expense.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleFinalize = async () => {
    try {
      setActionBusy(true);
      setErrorMsg(null);
      await api("admin_finalize_settlement", { tripId });
      setShowFinalizeModal(false);
      await fetchFinancials();
      onStatusChange?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to finalize settlement.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleMarkSentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTransfer) return;
    try {
      setActionBusy(true);
      setErrorMsg(null);
      await api("update_settlement_transfer", {
        transferId: selectedTransfer.id,
        action: "mark_sent",
        paymentMethod: transferMethod,
        notes: transferNotes.trim() || undefined,
      });
      setShowMarkSentModal(false);
      setSelectedTransfer(null);
      setTransferNotes("");
      await fetchFinancials();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to mark transfer as sent.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmReceived = async (transferId: string) => {
    try {
      setActionBusy(true);
      setErrorMsg(null);
      await api("update_settlement_transfer", {
        transferId,
        action: "confirm_received",
      });
      await fetchFinancials();
      onStatusChange?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to confirm receipt.");
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading trip financials and settlement...</p>
      </div>
    );
  }

  const isFinalized = data?.isFinalized ?? false;
  const isSettled = data?.settlementRun?.status === "settled" || tripStatus === "financially_settled";
  const totalExpensesCents = data?.settlementRun?.totalExpensesCents ?? 0;
  const totalTransfers = data?.transfers.length ?? 0;
  const completedTransfers = data?.transfers.filter((t) => t.status === "confirmed").length ?? 0;

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      {errorMsg && (
        <div className="card form-error" role="alert" style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}>
          <p style={{ margin: 0 }}>{errorMsg}</p>
        </div>
      )}

      {/* 1. Settlement Status Header Card */}
      <div className="card" style={{ background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)", border: "1px solid #cbd5e1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#0f172a" }}>💰 Settlement & Expenses</h2>
              {isSettled ? (
                <span className="status-badge-going" style={{ background: "#10b981", color: "#fff", fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "6px" }}>
                  ✅ Fully Settled
                </span>
              ) : isFinalized ? (
                <span style={{ background: "#3b82f6", color: "#fff", fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "6px", fontWeight: 600 }}>
                  🔒 Financially Finalized
                </span>
              ) : (
                <span style={{ background: "#f59e0b", color: "#fff", fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "6px", fontWeight: 600 }}>
                  Draft Calculation
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "#475569" }}>
              {isSettled
                ? "All peer-to-peer transfers have been confirmed received. Trip finances are completely resolved."
                : isFinalized
                ? "Expenses and odometer mileages are locked. Please complete peer transfers and confirm receipts below."
                : "Real-time preview of shared expenses, cabin deposits, and auto carpool reimbursements."}
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            {!isFinalized && isAdmin && (
              <button
                type="button"
                className="btn-primary"
                disabled={actionBusy || (data?.balances.length ?? 0) === 0}
                onClick={() => setShowFinalizeModal(true)}
                style={{ background: "#2563eb", color: "#fff", border: "none", padding: "0.5rem 1rem", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
              >
                🔒 Lock & Finalize Settlement
              </button>
            )}
          </div>
        </div>

        {/* Metrics Bar */}
        <div className="metric-boxes-grid" style={{ marginTop: "1.25rem" }}>
          <div className="metric-box-card">
            <p className="metric-value">{formatMoney(totalExpensesCents)}</p>
            <p className="metric-label">Total Trip Expenses</p>
          </div>
          <div className="metric-box-card">
            <p className="metric-value">
              {data?.settlementRun?.algorithmUsed === "exact" ? "Exact (DP)" : data?.settlementRun?.algorithmUsed === "greedy_fallback" ? "Greedy" : "Draft"}
            </p>
            <p className="metric-label">Settlement Algorithm</p>
          </div>
          <div className="metric-box-card">
            <p className="metric-value">
              {completedTransfers} / {totalTransfers}
            </p>
            <p className="metric-label">Transfers Reconciled</p>
          </div>
        </div>
      </div>

      {/* 2. Peer Transfers / Settlement Matrix */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>💸 Settlement Transfers</h3>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              External peer payments (Zelle, Venmo, PayPal, Apple Cash). Mark sent when paid, and recipient confirms receipt.
            </p>
          </div>
        </div>

        {(!data?.transfers || data.transfers.length === 0) ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#64748b", background: "#f8fafc", borderRadius: "8px" }}>
            <p style={{ margin: 0 }}>All accounts are settled. No transfers required.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.transfers.map((tx) => {
              const isPayer = tx.isPayer || tx.payerMemberId === currentMemberId;
              const isRecipient = tx.isRecipient || tx.recipientMemberId === currentMemberId;
              const isConfirmed = tx.status === "confirmed";
              const isSent = tx.status === "sent";

              return (
                <div
                  key={tx.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "1rem",
                    padding: "1rem",
                    borderRadius: "8px",
                    border: "1px solid",
                    borderColor: isConfirmed ? "#a7f3d0" : isSent ? "#fde68a" : "#e2e8f0",
                    background: isConfirmed ? "#f0fdf4" : isSent ? "#fefce8" : "#fff",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 600, color: "#1e293b", fontSize: "0.95rem" }}>
                        {tx.payerName} {isPayer && <span style={{ color: "#2563eb" }}>(You)</span>}
                      </span>
                      <span style={{ color: "#64748b" }}>➔</span>
                      <span style={{ fontWeight: 600, color: "#1e293b", fontSize: "0.95rem" }}>
                        {tx.recipientName} {isRecipient && <span style={{ color: "#2563eb" }}>(You)</span>}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: "1.05rem", color: "#0f172a", marginLeft: "0.25rem" }}>
                        {formatMoney(tx.amountCents)}
                      </span>
                    </div>

                    <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                      <span>Preferred: <strong>{tx.recipientPreferredMethod}</strong></span>
                      {tx.notes && <span style={{ marginLeft: "0.75rem", color: "#64748b" }}>• Note: "{tx.notes}"</span>}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {isConfirmed ? (
                      <span style={{ background: "#dcfce7", color: "#166534", fontSize: "0.8rem", padding: "0.25rem 0.6rem", borderRadius: "6px", fontWeight: 600 }}>
                        ✅ Confirmed Received
                      </span>
                    ) : isSent ? (
                      <span style={{ background: "#fef9c3", color: "#854d0e", fontSize: "0.8rem", padding: "0.25rem 0.6rem", borderRadius: "6px", fontWeight: 600 }}>
                        🟡 Sent ({tx.paymentMethod ?? "Transfer"}) · Awaiting Confirmation
                      </span>
                    ) : (
                      <span style={{ background: "#fee2e2", color: "#991b1b", fontSize: "0.8rem", padding: "0.25rem 0.6rem", borderRadius: "6px", fontWeight: 600 }}>
                        🔴 Outstanding
                      </span>
                    )}

                    {/* Action buttons */}
                    {isFinalized && !isConfirmed && (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        {/* Payer button: Mark Sent */}
                        {(isPayer || isAdmin) && !isSent && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => {
                              setSelectedTransfer(tx);
                              setShowMarkSentModal(true);
                            }}
                            style={{ background: "#2563eb", color: "#fff", border: "none", padding: "0.4rem 0.75rem", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer", fontWeight: 600 }}
                          >
                            Mark Sent
                          </button>
                        )}

                        {/* Recipient button: Confirm Received */}
                        {(isRecipient || isAdmin) && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleConfirmReceived(tx.id)}
                            style={{ background: "#10b981", color: "#fff", border: "none", padding: "0.4rem 0.75rem", borderRadius: "6px", fontSize: "0.85rem", cursor: "pointer", fontWeight: 600 }}
                          >
                            {isAdmin && !isRecipient ? "Confirm (Admin)" : "Confirm Received"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Member Net Balances */}
      <div className="card">
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>⚖️ Member Balances</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left", color: "#475569" }}>
                <th style={{ padding: "0.5rem" }}>Member</th>
                <th style={{ padding: "0.5rem", textAlign: "right" }}>Total Paid</th>
                <th style={{ padding: "0.5rem", textAlign: "right" }}>Fair Share</th>
                <th style={{ padding: "0.5rem", textAlign: "right" }}>Net Balance</th>
              </tr>
            </thead>
            <tbody>
              {data?.balances.map((b) => {
                const isMe = b.isMe || b.memberId === currentMemberId;
                const netCents = b.netBalanceCents;
                return (
                  <tr
                    key={b.memberId}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: isMe ? "#f8fafc" : "transparent",
                      fontWeight: isMe ? 600 : 400,
                    }}
                  >
                    <td style={{ padding: "0.6rem 0.5rem" }}>
                      {b.displayName} {isMe && <span style={{ color: "#2563eb" }}>(You)</span>}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>{formatMoney(b.totalPaidCents)}</td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>{formatMoney(b.totalAllocatedCents)}</td>
                    <td
                      style={{
                        padding: "0.6rem 0.5rem",
                        textAlign: "right",
                        color: netCents > 0 ? "#16a34a" : netCents < 0 ? "#dc2626" : "#64748b",
                        fontWeight: 600,
                      }}
                    >
                      {netCents > 0 ? `+${formatMoney(netCents)}` : formatMoney(netCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Unified Expense Ledger */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>📋 Unified Expense Ledger</h3>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              Comprehensive itemized breakdown across cabin advance, carpools, and shared receipts.
            </p>
          </div>

          {!isFinalized && (isAdmin || isConfirmedAttendee) && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowAddExpenseModal(true)}
              style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", padding: "0.4rem 0.8rem", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
            >
              + Add Shared Expense
            </button>
          )}
        </div>

        <div style={{ display: "grid", gap: "1rem" }}>
          {/* Cabin Deposit Section */}
          {data?.cabinDeposit ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem", background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#0f172a" }}>🏡 Cabin Deposit Advance</h4>
                  <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
                    Paid by <strong>{data.cabinDeposit.payerName}</strong> ({formatMoney(data.cabinDeposit.depositPerPersonCents)} per attendee × {data.cabinDeposit.confirmedCount} attendees)
                  </p>
                </div>
                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>
                  {formatMoney(data.cabinDeposit.amountCents)}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ border: "1px dashed #cbd5e1", borderRadius: "8px", padding: "1rem", background: "#f8fafc" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#475569" }}>🏡 Cabin Deposit ($50 / Attendee)</h4>
              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
                No cabin reservation payer is assigned yet. When assigned by an administrator via Edit Event, the $50/attendee deposit will automatically populate here in the ledger and route transfers in the settlement matrix.
              </p>
            </div>
          )}

          {/* Carpool Mileage Reimbursements */}
          {data?.carpoolReimbursements && data.carpoolReimbursements.length > 0 && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <h4 style={{ margin: "0.5rem 0 0 0", fontSize: "0.95rem", color: "#334155" }}>🚗 Carpool Mileage Reimbursements ($0.76/mile)</h4>
              {data.carpoolReimbursements.map((cpr) => (
                <div
                  key={cpr.carpoolId}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "0.85rem 1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#fff",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: "0.9rem" }}>{cpr.driverName}</strong>
                    <span style={{ color: "#64748b", fontSize: "0.85rem", marginLeft: "0.5rem" }}>
                      ({cpr.vehicleDescription}) • {cpr.milesDriven.toLocaleString()} mi
                    </span>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.2rem" }}>
                      Split equally among {cpr.occupantCount} occupants: {cpr.occupantNames.join(", ")}
                    </div>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>
                    {formatMoney(cpr.amountCents)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Member Shared Receipts */}
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <h4 style={{ margin: "0.5rem 0 0 0", fontSize: "0.95rem", color: "#334155" }}>🧾 Shared Member Receipts</h4>
            {(!data?.expenses || data.expenses.length === 0) ? (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b", fontStyle: "italic" }}>
                No shared receipts submitted yet.
              </p>
            ) : (
              data.expenses.map((exp) => (
                <div
                  key={exp.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "0.85rem 1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#fff",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.9rem" }}>{exp.description}</strong>
                      {exp.receiptUrl && (
                        <a
                          href={exp.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: "0.75rem", color: "#2563eb", textDecoration: "underline" }}
                        >
                          View Receipt
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.2rem" }}>
                      Paid by {exp.payerName} on {exp.incurredDate} • Split among {exp.allocations.length} members
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>
                      {formatMoney(exp.amountCents)}
                    </span>
                    {!isFinalized && (isAdmin || exp.payerMemberId === currentMemberId) && (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleDeleteExpense(exp.id)}
                        style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.85rem", padding: "0.25rem" }}
                        aria-label={`Delete ${exp.description}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* MODAL: Add Shared Expense */}
      {showAddExpenseModal && (
        <div className="modal-backdrop" onClick={() => setShowAddExpenseModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "460px" }}>
            <h3>+ Record Shared Expense</h3>
            <form onSubmit={handleCreateExpense} style={{ display: "grid", gap: "0.85rem", marginTop: "1rem" }}>
              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Description</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. S'mores, firewood, groceries"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Who Paid?</span>
                <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                  {confirmedAttendees.map((att) => (
                    <option key={att.memberId} value={att.memberId}>
                      {att.displayName} {att.memberId === currentMemberId ? "(You)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                  <span>Amount ($ USD)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="25.00"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                  <span>Date Incurred</span>
                  <input
                    type="date"
                    required
                    value={incurredDate}
                    onChange={(e) => setIncurredDate(e.target.value)}
                  />
                </label>
              </div>

              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Receipt URL (Optional)</span>
                <input
                  type="url"
                  placeholder="https://..."
                  value={receiptUrl}
                  onChange={(e) => setReceiptUrl(e.target.value)}
                />
              </label>

              <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>
                This expense will be split equally among all {confirmedAttendees.length} confirmed campers.
              </p>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button type="button" onClick={() => setShowAddExpenseModal(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={actionBusy} className="btn-primary">
                  {actionBusy ? "Saving..." : "Save Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Mark Sent */}
      {showMarkSentModal && selectedTransfer && (
        <div className="modal-backdrop" onClick={() => setShowMarkSentModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "420px" }}>
            <h3>Mark Payment as Sent</h3>
            <p style={{ fontSize: "0.9rem", color: "#475569" }}>
              You are recording that you sent <strong>{formatMoney(selectedTransfer.amountCents)}</strong> to <strong>{selectedTransfer.recipientName}</strong>.
            </p>

            <form onSubmit={handleMarkSentSubmit} style={{ display: "grid", gap: "0.85rem", marginTop: "0.75rem" }}>
              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Payment Method Used</span>
                <select value={transferMethod} onChange={(e) => setTransferMethod(e.target.value)}>
                  <option value="zelle">Zelle</option>
                  <option value="venmo">Venmo</option>
                  <option value="paypal">PayPal</option>
                  <option value="apple_cash">Apple Cash</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Note / Confirmation (Optional)</span>
                <input
                  type="text"
                  placeholder="e.g. Sent at 3:15pm via Zelle"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button type="button" onClick={() => setShowMarkSentModal(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={actionBusy} className="btn-primary">
                  {actionBusy ? "Submitting..." : "Confirm Sent"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Lock & Finalize Confirmation */}
      {showFinalizeModal && (
        <div className="modal-backdrop" onClick={() => setShowFinalizeModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <h3>🔒 Lock & Finalize Settlement?</h3>
            <p style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.5 }}>
              Locking and finalizing will snapshot all cabin obligations, odometer mileage reimbursements, and shared receipts.
            </p>
            <p style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.5 }}>
              Expenses will be locked from further edits, and the trip status will advance to <strong>Financially Finalized</strong> so members can begin settling balances.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="button" onClick={() => setShowFinalizeModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                className="btn-primary"
                onClick={handleFinalize}
                style={{ background: "#2563eb", color: "#fff", border: "none", padding: "0.5rem 1rem", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
              >
                {actionBusy ? "Finalizing..." : "Yes, Finalize Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
