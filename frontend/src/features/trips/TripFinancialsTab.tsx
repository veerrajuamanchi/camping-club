import React, { useEffect, useState } from "react";
import type { TripApiType } from "./EventDetailsPage";
import { calculateEqualAllocations } from "../../domain/settlementEngine";
import { supabase } from "../../lib/supabase";

export type ExpenseAllocation = {
  memberId: string;
  memberName: string;
  allocatedCents: number;
  isMe: boolean;
};

export type TripExpense = {
  id: string;
  expenseType: "cabin_deposit" | "carpool_mileage" | "shared_receipt" | "website_maintenance" | "other";
  splitMode?: "all_attendees" | "custom";
  payerMemberId: string;
  payerName: string;
  amountCents: number;
  description: string;
  incurredDate: string;
  receiptUrl: string | null;
  receiptStoragePath?: string | null;
  receiptFileName?: string | null;
  receiptContentType?: string | null;
  isLocked: boolean;
  allocations: ExpenseAllocation[];
};

export type CarpoolReimbursement = {
  carpoolId: string;
  driverMemberId: string;
  driverName: string;
  vehicleDescription: string;
  milesDriven: number;
  rateCentsPerMile?: number;
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
  depositPaidCents?: number;
  depositReceivedCents?: number;
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

  // Candidate attendees list merged from confirmedAttendees prop and fetched balances
  const attendeesList = (
    confirmedAttendees.length > 0
      ? confirmedAttendees
      : (data?.balances ?? []).map((b) => ({ memberId: b.memberId, displayName: b.displayName }))
  ).map((att) => ({
    memberId: att.memberId,
    displayName:
      att.displayName?.trim() ||
      data?.balances?.find((b) => b.memberId === att.memberId)?.displayName?.trim() ||
      "Camper",
  }));

  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [desc, setDesc] = useState("");
  const [payerId, setPayerId] = useState(currentMemberId ?? (attendeesList[0]?.memberId || ""));
  const [amountStr, setAmountStr] = useState("");
  const [incurredDate, setIncurredDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptUrl, setReceiptUrl] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<"all_attendees" | "custom">("all_attendees");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<{
    url: string;
    fileName: string;
    contentType?: string | null;
  } | null>(null);

  const openAddExpenseModal = () => {
    setDesc("");
    setPayerId(currentMemberId ?? (attendeesList[0]?.memberId || ""));
    setAmountStr("");
    setReceiptUrl("");
    setReceiptFile(null);
    setSplitMode("all_attendees");
    setIncurredDate(new Date().toISOString().slice(0, 10));
    setSelectedParticipantIds(attendeesList.map((a) => a.memberId));
    setShowAddExpenseModal(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const validExts = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
    const ext = "." + file.name.split(".").pop()?.toLowerCase();

    if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
      setErrorMsg("Unsupported file type. Please upload a JPEG, PNG, WebP image, or PDF.");
      e.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg("Receipt file must be 5MB or smaller.");
      e.target.value = "";
      return;
    }

    setErrorMsg(null);
    setReceiptFile(file);
  };

  const handleOpenReceiptViewer = async (exp: TripExpense) => {
    try {
      setActionBusy(true);
      let viewUrl = exp.receiptUrl || "";
      if (exp.receiptStoragePath && supabase) {
        const { data: signedData, error: signedErr } = await supabase.storage
          .from("trip-receipts")
          .createSignedUrl(exp.receiptStoragePath, 3600);
        if (signedErr) throw signedErr;
        if (signedData?.signedUrl) {
          viewUrl = signedData.signedUrl;
        }
      }
      if (!viewUrl) {
        setErrorMsg("Receipt URL is not available.");
        return;
      }
      setPreviewReceipt({
        url: viewUrl,
        fileName: exp.receiptFileName || exp.description || "Receipt",
        contentType: exp.receiptContentType,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load receipt preview.");
    } finally {
      setActionBusy(false);
    }
  };

  // Mark Sent Modal
  const [showMarkSentModal, setShowMarkSentModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<SettlementTransfer | null>(null);
  const [transferMethod, setTransferMethod] = useState("zelle");
  const [transferNotes, setTransferNotes] = useState("");

  // Finalize Confirmation Modal
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  // Edit Expense Modal state
  const [editingExpense, setEditingExpense] = useState<TripExpense | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editPayerId, setEditPayerId] = useState("");
  const [editDollars, setEditDollars] = useState("");
  const [editIncurredDate, setEditIncurredDate] = useState("");

  const handleOpenEditExpense = (exp: TripExpense) => {
    setEditingExpense(exp);
    setEditDesc(exp.description);
    setEditPayerId(exp.payerMemberId);
    setEditDollars((exp.amountCents / 100).toFixed(2));
    setEditIncurredDate(exp.incurredDate);
  };

  const handleSaveEditExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense) return;
    const dollars = parseFloat(editDollars);
    if (isNaN(dollars) || dollars <= 0) {
      setErrorMsg("Please enter a valid expense amount greater than $0.00.");
      return;
    }
    const amountCents = Math.round(dollars * 100);
    try {
      setActionBusy(true);
      setErrorMsg(null);
      await api("admin_manage_trip_expense", {
        tripId,
        action: "update",
        expenseId: editingExpense.id,
        description: editDesc.trim(),
        payerMemberId: editPayerId || editingExpense.payerMemberId,
        amountCents,
        incurredDate: editIncurredDate || editingExpense.incurredDate,
      });
      setEditingExpense(null);
      await fetchFinancials();
    } catch (err: any) {
      console.error("Update expense failed:", err);
      setErrorMsg(err?.message || "Failed to update expense.");
    } finally {
      setActionBusy(false);
    }
  };

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

    const effectiveSplitMode =
      splitMode === "all_attendees" || (splitMode === "custom" && selectedParticipantIds.length === attendeesList.length && attendeesList.length > 0)
        ? "all_attendees"
        : "custom";

    const participantsToSplit =
      effectiveSplitMode === "all_attendees"
        ? attendeesList.map((a) => a.memberId)
        : selectedParticipantIds;

    if (participantsToSplit.length === 0) {
      setErrorMsg(
        effectiveSplitMode === "all_attendees"
          ? "No confirmed attendees available to split this expense."
          : "Please select at least one participant to split this expense."
      );
      return;
    }
    const equalAllocations = calculateEqualAllocations(amountCents, participantsToSplit);
    const allocationMap = new Map(equalAllocations.map((a) => [a.memberId, a.allocatedCents]));
    const allocations = participantsToSplit.map((memberId) => ({
      memberId,
      allocatedCents: allocationMap.get(memberId) ?? 0,
    }));

    try {
      setActionBusy(true);
      setErrorMsg(null);

      let receiptStoragePath: string | null = null;
      let receiptFileName: string | null = null;
      let receiptContentType: string | null = null;

      if (receiptFile) {
        if (!supabase) {
          throw new Error("Supabase client is not available for upload.");
        }
        const fileId = crypto.randomUUID();
        const safeName = receiptFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const filePath = `trips/${tripId}/${fileId}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("trip-receipts")
          .upload(filePath, receiptFile, { contentType: receiptFile.type });
        if (uploadError) {
          throw new Error(`Failed to upload receipt: ${uploadError.message}`);
        }
        receiptStoragePath = filePath;
        receiptFileName = receiptFile.name;
        receiptContentType = receiptFile.type;
      }

      await api("admin_manage_trip_expense", {
        tripId,
        action: "create",
        expenseType: "shared_receipt",
        payerMemberId: payerId || currentMemberId,
        amountCents,
        description: desc.trim(),
        incurredDate,
        receiptUrl: receiptUrl.trim() || undefined,
        splitMode: effectiveSplitMode,
        receiptStoragePath: receiptStoragePath || undefined,
        receiptFileName: receiptFileName || undefined,
        receiptContentType: receiptContentType || undefined,
        allocations,
      });
      setShowAddExpenseModal(false);
      setDesc("");
      setAmountStr("");
      setReceiptUrl("");
      setReceiptFile(null);
      setSplitMode("all_attendees");
      await fetchFinancials();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to record expense.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleExpenseSplitMode = async (expenseId: string, nextMode: "all_attendees" | "custom") => {
    try {
      setActionBusy(true);
      setErrorMsg(null);
      await api("admin_manage_trip_expense", {
        tripId,
        action: "update",
        expenseId,
        splitMode: nextMode,
      });
      await fetchFinancials();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to update expense split mode.");
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem" }}>⚖️ Member Balances</h3>
          <span style={{ fontSize: "0.8rem", color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.2rem 0.5rem", borderRadius: "4px", fontWeight: 500 }}>
            ✓ Verified $50 deposits are credited, reducing your settlement amount
          </span>
        </div>
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
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>
                      <div>{formatMoney(b.totalPaidCents)}</div>
                      {(b.depositPaidCents ?? 0) > 0 && (
                        <div style={{ fontSize: "0.72rem", color: "#15803d", fontWeight: 500 }}>
                          (incl. {formatMoney(b.depositPaidCents!)} deposit)
                        </div>
                      )}
                      {(b.depositReceivedCents ?? 0) > 0 && (
                        <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 500 }}>
                          (less {formatMoney(b.depositReceivedCents!)} deposits rec'd)
                        </div>
                      )}
                    </td>
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
              onClick={openAddExpenseModal}
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
              <h4 style={{ margin: "0.5rem 0 0 0", fontSize: "0.95rem", color: "#334155" }}>
                🚗 Carpool Mileage Reimbursements ({`$${((data.carpoolReimbursements[0]?.rateCentsPerMile ?? 50) / 100).toFixed(2)}/mile`})
              </h4>
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
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: "0.9rem" }}>{exp.description}</strong>
                      {exp.expenseType === "website_maintenance" ? (
                        <span
                          style={{
                            background: "#e0e7ff",
                            color: "#3730a3",
                            border: "1px solid #c7d2fe",
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontWeight: 600,
                          }}
                        >
                          🌐 Website Maintenance
                        </span>
                      ) : exp.splitMode === "all_attendees" ? (
                        <span
                          style={{
                            background: "#dcfce7",
                            color: "#166534",
                            border: "1px solid #86efac",
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontWeight: 600,
                          }}
                        >
                          🌐 All Attendees (Dynamic)
                        </span>
                      ) : (
                        <span
                          style={{
                            background: "#fef3c7",
                            color: "#92400e",
                            border: "1px solid #fde68a",
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontWeight: 600,
                          }}
                        >
                          👥 Custom Split ({exp.allocations.length} campers)
                        </span>
                      )}
                      {(exp.receiptStoragePath || exp.receiptUrl) && (
                        <button
                          type="button"
                          onClick={() => handleOpenReceiptViewer(exp)}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            fontSize: "0.75rem",
                            color: "#2563eb",
                            textDecoration: "underline",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.2rem",
                          }}
                        >
                          📄 View Receipt
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.2rem" }}>
                      Paid by {exp.payerName} on {exp.incurredDate} • Split among {exp.allocations.length} members
                      {exp.splitMode === "all_attendees" && " (auto-includes new attendees)"}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {!isFinalized && isAdmin && (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={actionBusy}
                        onClick={() => handleOpenEditExpense(exp)}
                        style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "6px" }}
                        title="Edit expense details and who paid"
                        aria-label={`Edit ${exp.description}`}
                      >
                        ✏️ Edit
                      </button>
                    )}
                    {!isFinalized && isAdmin && (
                      exp.splitMode === "all_attendees" ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={actionBusy}
                          onClick={() => handleToggleExpenseSplitMode(exp.id, "custom")}
                          style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "6px" }}
                          title="Convert to fixed static allocations for current attendees"
                        >
                          Make Custom 🎯
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={actionBusy}
                          onClick={() => handleToggleExpenseSplitMode(exp.id, "all_attendees")}
                          style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "6px" }}
                          title="Convert to dynamic split across all confirmed attendees"
                        >
                          Make Dynamic 🌐
                        </button>
                      )
                    )}
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
                  {attendeesList.map((att) => (
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

              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label htmlFor="receipt-upload" style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1e293b" }}>
                  Attach Receipt (Optional)
                </label>
                <input
                  id="receipt-upload"
                  data-testid="receipt-file-input"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleFileChange}
                  style={{ fontSize: "0.85rem" }}
                />
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    fontSize: "0.75rem",
                    color: "#059669",
                    background: "#ecfdf5",
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px",
                    width: "fit-content",
                  }}
                >
                  <span>✓ Kept for last 3 campings, then auto-deleted</span>
                </div>
                {receiptFile && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", color: "#334155" }}>
                    <span>📎 {receiptFile.name} ({(receiptFile.size / 1024).toFixed(1)} KB)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptFile(null);
                        const fileInput = document.getElementById("receipt-upload") as HTMLInputElement | null;
                        if (fileInput) fileInput.value = "";
                      }}
                      style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}
                    >
                      ✕ Remove
                    </button>
                  </div>
                )}
              </div>

              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Or Receipt URL (Optional)</span>
                <input
                  type="url"
                  placeholder="https://..."
                  value={receiptUrl}
                  onChange={(e) => setReceiptUrl(e.target.value)}
                />
              </label>

              <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.25rem" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1e293b" }}>Split Mode</span>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.9rem" }}>
                    <input
                      type="radio"
                      name="splitMode"
                      value="all_attendees"
                      checked={splitMode === "all_attendees"}
                      onChange={() => setSplitMode("all_attendees")}
                    />
                    <span>All Attendees (Dynamic)</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.9rem" }}>
                    <input
                      type="radio"
                      name="splitMode"
                      value="custom"
                      checked={splitMode === "custom"}
                      onChange={() => setSplitMode("custom")}
                    />
                    <span>Custom Subset</span>
                  </label>
                </div>
              </div>

              {splitMode === "all_attendees" ? (
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "6px",
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    fontSize: "0.85rem",
                    color: "#166534",
                  }}
                >
                  {(() => {
                    const previewAmountCents = Math.round((parseFloat(amountStr) || 0) * 100);
                    const estPerPerson =
                      attendeesList.length > 0 && previewAmountCents > 0
                        ? ` = ${formatMoney(Math.round(previewAmountCents / attendeesList.length))}/person`
                        : "";
                    return (
                      <p style={{ margin: 0, lineHeight: 1.4 }}>
                        Splits equally among all confirmed attendees (currently {attendeesList.length} campers{estPerPerson}). New attendees who join later will automatically be included.
                      </p>
                    );
                  })()}
                </div>
              ) : (
                <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.25rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1e293b" }}>
                      Split Between Participants:
                    </span>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.8rem", padding: "0.25rem 0.65rem", borderRadius: "9999px" }}
                        onClick={() => setSelectedParticipantIds(attendeesList.map((a) => a.memberId))}
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.8rem", padding: "0.25rem 0.65rem", borderRadius: "9999px" }}
                        onClick={() => setSelectedParticipantIds([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {selectedParticipantIds.length === attendeesList.length && attendeesList.length > 0 ? (
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "6px", padding: "0.4rem 0.65rem", fontSize: "0.8rem", color: "#166534", fontWeight: 500 }}>
                      🌐 All {attendeesList.length} campers selected — this expense will dynamically split across all attendees, including any new campers who join later.
                    </div>
                  ) : (
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "0.4rem 0.65rem", fontSize: "0.8rem", color: "#92400e" }}>
                      🎯 Custom subset: {selectedParticipantIds.length} of {attendeesList.length} campers selected (fixed split).
                    </div>
                  )}

                  <div
                    data-testid="expense-split-list"
                    style={{
                      maxHeight: "220px",
                      overflowY: "auto",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: "0.5rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      background: "#f8fafc",
                    }}
                  >
                    {attendeesList.map((att) => {
                      const isChecked = selectedParticipantIds.includes(att.memberId);
                      const displayName = att.displayName?.trim() || "Camper";
                      return (
                        <label
                          key={att.memberId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.75rem",
                            fontSize: "0.95rem",
                            cursor: "pointer",
                            padding: "0.5rem 0.75rem",
                            borderRadius: "6px",
                            border: isChecked ? "1px solid #86efac" : "1px solid #e2e8f0",
                            background: isChecked ? "#f0fdf4" : "#ffffff",
                            minHeight: "44px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            style={{
                              width: "20px",
                              height: "20px",
                              flexShrink: 0,
                              margin: 0,
                              cursor: "pointer",
                            }}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedParticipantIds((prev) => [...prev, att.memberId]);
                              } else {
                                setSelectedParticipantIds((prev) => prev.filter((id) => id !== att.memberId));
                              }
                            }}
                          />
                          <span
                            style={{
                              minWidth: 0,
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              color: "#0f172a",
                              fontWeight: 600,
                            }}
                          >
                            {displayName} {att.memberId === currentMemberId ? "(You)" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {(() => {
                    const previewAmountCents = Math.round((parseFloat(amountStr) || 0) * 100);
                    if (selectedParticipantIds.length > 0 && previewAmountCents > 0) {
                      const estPerPersonCents = Math.round(previewAmountCents / selectedParticipantIds.length);
                      return (
                        <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem", color: "#0369a1" }}>
                          Splitting equally among {selectedParticipantIds.length} participant{selectedParticipantIds.length > 1 ? "s" : ""}: ~{formatMoney(estPerPersonCents)} each.
                        </p>
                      );
                    }
                    return (
                      <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem", color: selectedParticipantIds.length === 0 ? "#dc2626" : "#64748b" }}>
                        {selectedParticipantIds.length === 0
                          ? "⚠️ Please select at least one participant."
                          : `Selected ${selectedParticipantIds.length} participant(s).`}
                      </p>
                    );
                  })()}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button type="button" onClick={() => setShowAddExpenseModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    actionBusy ||
                    (splitMode === "custom" && selectedParticipantIds.length === 0) ||
                    (splitMode === "all_attendees" && attendeesList.length === 0)
                  }
                  className="btn-primary"
                >
                  {actionBusy ? "Saving..." : "Save Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit Shared Expense */}
      {editingExpense && (
        <div className="modal-backdrop" onClick={() => setEditingExpense(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "460px" }}>
            <h3>✏️ Edit Expense</h3>
            <form onSubmit={handleSaveEditExpense} style={{ display: "grid", gap: "0.85rem", marginTop: "1rem" }}>
              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Description</span>
                <input
                  type="text"
                  required
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Who Paid?</span>
                <select value={editPayerId} onChange={(e) => setEditPayerId(e.target.value)}>
                  {attendeesList.map((att) => (
                    <option key={att.memberId} value={att.memberId}>
                      {att.displayName} {att.memberId === currentMemberId ? "(You)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Amount ($)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={editDollars}
                  onChange={(e) => setEditDollars(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.9rem" }}>
                <span>Date Incurred</span>
                <input
                  type="date"
                  required
                  value={editIncurredDate}
                  onChange={(e) => setEditIncurredDate(e.target.value)}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={actionBusy}
                  onClick={() => setEditingExpense(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={actionBusy}>
                  {actionBusy ? "Saving..." : "Save Changes"}
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

      {/* MODAL: Receipt Viewer */}
      {previewReceipt && (
        <ReceiptViewerModal
          receipt={previewReceipt}
          onClose={() => setPreviewReceipt(null)}
        />
      )}
    </div>
  );
}

export function ReceiptViewerModal({
  receipt,
  onClose,
}: {
  receipt: { url: string; fileName: string; contentType?: string | null };
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const isPdf =
    receipt.contentType === "application/pdf" ||
    receipt.fileName?.toLowerCase().endsWith(".pdf") ||
    receipt.url.toLowerCase().includes(".pdf");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-label="Receipt Preview"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "680px",
          width: "95%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #e2e8f0",
            paddingBottom: "0.5rem",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "1.1rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            📄 {receipt.fileName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              padding: "0.25rem 0.5rem",
              color: "#64748b",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "280px",
          }}
        >
          {isPdf ? (
            <div style={{ width: "100%", height: "460px", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <iframe
                src={receipt.url}
                title={receipt.fileName}
                style={{ width: "100%", height: "100%", border: "1px solid #cbd5e1", borderRadius: "6px" }}
              />
              <div style={{ textAlign: "right" }}>
                <a href={receipt.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.85rem", color: "#2563eb" }}>
                  ↗ Open PDF in new tab
                </a>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", width: "100%" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                >
                  - Zoom Out
                </button>
                <span style={{ fontSize: "0.85rem", minWidth: "45px", textAlign: "center", fontWeight: 600 }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                >
                  + Zoom In
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setZoom(1)}
                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                >
                  Reset
                </button>
              </div>

              <div
                style={{
                  overflow: "auto",
                  maxWidth: "100%",
                  maxHeight: "55vh",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  padding: "0.5rem",
                  background: "#f8fafc",
                }}
              >
                <img
                  src={receipt.url}
                  alt={receipt.fileName}
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "center top",
                    transition: "transform 0.15s ease",
                    maxWidth: "100%",
                    display: "block",
                  }}
                />
              </div>

              <div>
                <a href={receipt.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.85rem", color: "#2563eb" }}>
                  ↗ Open original image in new tab
                </a>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #e2e8f0", paddingTop: "0.75rem" }}>
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
