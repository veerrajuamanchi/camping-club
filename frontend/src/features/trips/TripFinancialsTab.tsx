import React, { useEffect, useMemo, useState } from "react";
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
  isMobile?: boolean;
};

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function detectIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.screen !== "undefined") {
    const minDim = Math.min(window.screen.width, window.screen.height);
    if (minDim > 0 && minDim <= 500) {
      return true;
    }
  }
  return window.innerWidth < 768;
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
  isMobile: isMobileProp,
}: Props) {
  const [internalIsMobile, setInternalIsMobile] = useState(detectIsMobile);

  useEffect(() => {
    const handleResize = () => {
      setInternalIsMobile(detectIsMobile());
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  const isMobile = isMobileProp ?? internalIsMobile;
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
  const [editSplitMode, setEditSplitMode] = useState<"all_attendees" | "custom">("all_attendees");
  const [editSelectedParticipantIds, setEditSelectedParticipantIds] = useState<string[]>([]);

  // Mobile Hub active navigation tab: "receipts" | "campers" | "ledger"
  const [activeMobileTab, setActiveMobileTab] = useState<"receipts" | "campers" | "ledger">("receipts");
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ left: 0 });
    }
  }, [activeMobileTab]);

  const handleCopyPaymentDetails = (text: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }
    } catch (err) {
      console.warn("Failed to copy payment details:", err);
    }
  };


  const handleOpenEditExpense = (exp: TripExpense) => {
    setEditingExpense(exp);
    setEditDesc(exp.description);
    setEditPayerId(exp.payerMemberId);
    setEditDollars((exp.amountCents / 100).toFixed(2));
    setEditIncurredDate(exp.incurredDate);
    const mode = exp.splitMode === "custom" ? "custom" : "all_attendees";
    setEditSplitMode(mode);
    const allocatedMemberIds = (exp.allocations ?? []).map((a) => a.memberId);
    setEditSelectedParticipantIds(
      allocatedMemberIds.length > 0
        ? allocatedMemberIds
        : attendeesList.map((a) => a.memberId)
    );
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

    const effectiveEditSplitMode =
      editSplitMode === "all_attendees" ||
      (editSplitMode === "custom" && editSelectedParticipantIds.length === attendeesList.length && attendeesList.length > 0)
        ? "all_attendees"
        : "custom";

    const participantsToSplit =
      effectiveEditSplitMode === "all_attendees"
        ? attendeesList.map((a) => a.memberId)
        : editSelectedParticipantIds;

    if (participantsToSplit.length === 0) {
      setErrorMsg(
        effectiveEditSplitMode === "all_attendees"
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
      await api("admin_manage_trip_expense", {
        tripId,
        action: "update",
        expenseId: editingExpense.id,
        description: editDesc.trim(),
        payerMemberId: editPayerId || editingExpense.payerMemberId,
        amountCents,
        incurredDate: editIncurredDate || editingExpense.incurredDate,
        splitMode: effectiveEditSplitMode,
        allocations,
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

  // Fast lookup for member settlement balances
  const balancesMap = useMemo(() => {
    const map = new Map<string, SettlementBalance>();
    if (data?.balances) {
      for (const b of data.balances) {
        map.set(b.memberId, b);
      }
    }
    return map;
  }, [data?.balances]);

  // Unique list of members to display as spreadsheet columns
  const matrixMembers = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { memberId: string; displayName: string; isMe: boolean }>();
    for (const b of (data.balances ?? [])) {
      map.set(b.memberId, { memberId: b.memberId, displayName: b.displayName, isMe: b.isMe });
    }
    for (const ca of (confirmedAttendees ?? [])) {
      if (!map.has(ca.memberId)) {
        map.set(ca.memberId, { memberId: ca.memberId, displayName: ca.displayName, isMe: ca.memberId === currentMemberId });
      }
    }
    if (data.cabinDeposit) {
      const cabinAllocs = (data.cabinDeposit.allocations ?? []).length > 0
        ? data.cabinDeposit.allocations
        : (confirmedAttendees ?? [])
            .filter((ca) => ca.memberId !== data.cabinDeposit!.payerMemberId)
            .map((ca) => ({
              memberId: ca.memberId,
              memberName: ca.displayName,
              allocatedCents: data.cabinDeposit!.depositPerPersonCents,
              isMe: ca.memberId === currentMemberId,
            }));
      for (const a of cabinAllocs) {
        if (!map.has(a.memberId)) {
          map.set(a.memberId, { memberId: a.memberId, displayName: a.memberName, isMe: a.isMe });
        }
      }
    }
    for (const exp of (data.expenses ?? [])) {
      for (const a of (exp.allocations ?? [])) {
        if (!map.has(a.memberId)) {
          map.set(a.memberId, { memberId: a.memberId, displayName: a.memberName, isMe: a.isMe });
        }
      }
    }
    for (const cpr of (data.carpoolReimbursements ?? [])) {
      for (const a of (cpr.allocations ?? [])) {
        if (!map.has(a.memberId)) {
          map.set(a.memberId, { memberId: a.memberId, displayName: a.memberName, isMe: a.isMe });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.isMe && !b.isMe) return -1;
      if (!a.isMe && b.isMe) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [data, confirmedAttendees, currentMemberId]);

  type MatrixRow = {
    id: string;
    category: "cabin" | "carpool" | "shared" | "website";
    title: string;
    tagLabel: string;
    tagStyle: { bg: string; color: string; border: string };
    payerName: string;
    payerMemberId: string;
    date?: string;
    totalCents: number;
    rawExpense?: TripExpense;
    allocationsMap: Map<string, number>;
  };

  const matrixRows = useMemo<MatrixRow[]>(() => {
    if (!data) return [];
    const rows: MatrixRow[] = [];

    // 1. Cabin Deposit Advance
    if (data.cabinDeposit) {
      const cabinAllocs = data.cabinDeposit.allocations ?? [];

      rows.push({
        id: "cabin-deposit",
        category: "cabin",
        title: "🏡 Cabin Deposit Advance (Prepayments)",
        tagLabel: `🏡 Cabin Advance (${formatMoney(data.cabinDeposit.depositPerPersonCents)}/camper)`,
        tagStyle: { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
        payerName: `Collected by ${data.cabinDeposit.payerName}`,
        payerMemberId: data.cabinDeposit.payerMemberId,
        totalCents: data.cabinDeposit.amountCents,
        allocationsMap: new Map(cabinAllocs.map((a) => [a.memberId, a.allocatedCents])),
      });
    }

    // 2. Carpools
    for (const cpr of (data.carpoolReimbursements ?? [])) {
      const cprAllocs = cpr.allocations ?? [];
      rows.push({
        id: `carpool-${cpr.carpoolId}`,
        category: "carpool",
        title: `🚗 Carpool Mileage Reimbursement: ${cpr.driverName}`,
        tagLabel: `Carpool Mileage Reimbursements ($${((cpr.rateCentsPerMile ?? 50) / 100).toFixed(2)}/mile)`,
        tagStyle: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
        payerName: cpr.driverName,
        payerMemberId: cpr.driverMemberId,
        totalCents: cpr.amountCents,
        allocationsMap: new Map(cprAllocs.map((a) => [a.memberId, a.allocatedCents])),
      });
    }

    // 3. Shared Member Receipts (excluding website maintenance)
    const nonWebsiteExpenses = (data.expenses ?? []).filter((exp) => exp.expenseType !== "website_maintenance");
    const websiteExpenses = (data.expenses ?? []).filter((exp) => exp.expenseType === "website_maintenance");

    for (const exp of nonWebsiteExpenses) {
      const expAllocs = exp.allocations ?? [];
      const isDynamic = exp.splitMode === "all_attendees";
      let tagLabel = `👥 Custom Split (${expAllocs.length} campers)`;
      let tagStyle = { bg: "#fef3c7", color: "#92400e", border: "#fde68a" };

      if (isDynamic) {
        tagLabel = "🌐 All Attendees (Dynamic)";
        tagStyle = { bg: "#dcfce7", color: "#166534", border: "#86efac" };
      }

      rows.push({
        id: `exp-${exp.id}`,
        category: "shared",
        title: exp.description,
        tagLabel,
        tagStyle,
        payerName: exp.payerName,
        payerMemberId: exp.payerMemberId,
        date: exp.incurredDate,
        totalCents: exp.amountCents,
        rawExpense: exp,
        allocationsMap: new Map(expAllocs.map((a) => [a.memberId, a.allocatedCents])),
      });
    }

    // 4. Website Build & Maintenance Fees (consolidated into two distinct canonical rows)
    const firstEventAllocs = new Map<string, number>();
    const returningMemberAllocs = new Map<string, number>();
    let adminPayerName = "Veerraju Amanchi";
    let adminPayerId = "";

    for (const we of websiteExpenses) {
      if (we.payerName) adminPayerName = we.payerName;
      if (we.payerMemberId) adminPayerId = we.payerMemberId;
      for (const a of (we.allocations ?? [])) {
        if (we.description.includes("2.50") || we.description.includes("Returning")) {
          returningMemberAllocs.set(a.memberId, a.allocatedCents);
        } else {
          firstEventAllocs.set(a.memberId, a.allocatedCents);
        }
      }
    }

    // Row 1: Website Build & Maintenance Fee ($5.00 - First Event)
    const firstEventTotalCents = Array.from(firstEventAllocs.values()).reduce((sum, c) => sum + c, 0);
    if (firstEventTotalCents > 0) {
      rows.push({
        id: "website-fee-first-event",
        category: "website",
        title: "🌐 Website Build & Maintenance Fee ($5.00 - First Event)",
        tagLabel: "🌐 Website Maintenance ($5.00)",
        tagStyle: { bg: "#e0e7ff", color: "#3730a3", border: "#c7d2fe" },
        payerName: adminPayerName,
        payerMemberId: adminPayerId,
        totalCents: firstEventTotalCents,
        allocationsMap: firstEventAllocs,
      });
    }

    // Row 2: Website Build & Maintenance Fee ($2.50 - Returning Member)
    const returningMemberTotalCents = Array.from(returningMemberAllocs.values()).reduce((sum, c) => sum + c, 0);
    if (returningMemberTotalCents > 0) {
      rows.push({
        id: "website-fee-returning-member",
        category: "website",
        title: "🌐 Website Build & Maintenance Fee ($2.50 - Returning Member)",
        tagLabel: "🌐 Website Maintenance ($2.50)",
        tagStyle: { bg: "#e0e7ff", color: "#3730a3", border: "#c7d2fe" },
        payerName: adminPayerName,
        payerMemberId: adminPayerId,
        totalCents: returningMemberTotalCents,
        allocationsMap: returningMemberAllocs,
      });
    }

    return rows;
  }, [data, confirmedAttendees, currentMemberId]);

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
  const totalTransfers = data?.transfers?.length ?? 0;
  const completedTransfers = (data?.transfers ?? []).filter((t) => t.status === "confirmed").length;

  const myBalance = (data?.balances ?? []).find((b) => b.isMe || b.memberId === currentMemberId);
  const myNetCents = myBalance?.netBalanceCents ?? 0;
  const myTotalPaidCents = myBalance?.totalPaidCents ?? 0;
  const myTotalAllocatedCents = myBalance?.totalAllocatedCents ?? 0;
  const myOutgoingTransfer = (data?.transfers ?? []).find(
    (tx) => (tx.isPayer || tx.payerMemberId === currentMemberId) && tx.status !== "confirmed"
  );

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      {errorMsg && (
        <div className="card form-error" role="alert" style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}>
          <p style={{ margin: 0 }}>{errorMsg}</p>
        </div>
      )}

      {/* Mobile-Only Hero Snapshot, Add Expense Action & 4-Tab Navigation */}
      {isMobile && (
        <>
          {/* Hero Personal Settlement Snapshot */}
          <div
            className="card hero-personal-snapshot"
            style={{
              background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
              color: "#ffffff",
              borderRadius: "12px",
              padding: "1.25rem",
              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.15)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
              <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#94a3b8", fontWeight: 700 }}>
                Your Settlement Position
              </div>
              <div
                data-testid="hero-trip-total-badge"
                style={{
                  background: "rgba(255, 255, 255, 0.12)",
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                  borderRadius: "9999px",
                  padding: "0.2rem 0.65rem",
                  fontSize: "0.78rem",
                  color: "#e2e8f0",
                  fontWeight: 600,
                }}
              >
                💰 Trip Total: <strong style={{ color: "#ffffff" }}>{formatMoney(totalExpensesCents)}</strong> • {(data?.balances ?? []).length} Campers
              </div>
            </div>
            <div
              style={{
                fontSize: "1.75rem",
                fontWeight: 800,
                margin: "0.35rem 0",
                display: "flex",
                alignItems: "baseline",
                gap: "0.5rem",
                color: myNetCents < 0 ? "#f87171" : myNetCents > 0 ? "#34d399" : "#cbd5e1",
              }}
            >
              <span>
                {myNetCents < 0
                  ? `-${formatMoney(Math.abs(myNetCents))}`
                  : myNetCents > 0
                  ? `+${formatMoney(myNetCents)}`
                  : "$0.00"}
              </span>
              <span style={{ fontSize: "0.88rem", fontWeight: 600, color: myNetCents < 0 ? "#fca5a5" : myNetCents > 0 ? "#a7f3d0" : "#94a3b8" }}>
                {myNetCents < 0 ? "(You Owe)" : myNetCents > 0 ? "(You Receive)" : "(Fully Settled)"}
              </span>
            </div>
            <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.82rem", color: "#cbd5e1" }}>
              Based on {formatMoney(myTotalPaidCents)} paid vs {formatMoney(myTotalAllocatedCents)} total fair share.
            </p>

            {myOutgoingTransfer && (
              <div
                style={{
                  marginTop: "0.85rem",
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                  borderRadius: "8px",
                  padding: "0.75rem 0.85rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  alignItems: "flex-start",
                }}
              >
                <div style={{ fontSize: "0.82rem", color: "#e2e8f0" }}>
                  Send {formatMoney(myOutgoingTransfer.amountCents)} to <strong>{myOutgoingTransfer.recipientName}</strong> via{" "}
                  <strong>{myOutgoingTransfer.recipientPreferredMethod}</strong>
                  {myOutgoingTransfer.notes && (
                    <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: "0.15rem" }}>
                      Note / ID: {myOutgoingTransfer.notes}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", width: "100%", justifyContent: "flex-start" }}>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyPaymentDetails(
                        `${myOutgoingTransfer.recipientName} (${myOutgoingTransfer.recipientPreferredMethod}): ${myOutgoingTransfer.notes || ""}`
                      )
                    }
                    style={{
                      background: "#334155",
                      color: "#ffffff",
                      border: "none",
                      padding: "0.4rem 0.75rem",
                      borderRadius: "6px",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {copySuccess ? "✓ Copied!" : "📋 Copy Details"}
                  </button>
                  {isFinalized && myOutgoingTransfer.status === "outstanding" && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTransfer(myOutgoingTransfer);
                        setShowMarkSentModal(true);
                      }}
                      style={{
                        background: "#10b981",
                        color: "#ffffff",
                        border: "none",
                        padding: "0.4rem 0.75rem",
                        borderRadius: "6px",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      ✓ Mark as Sent
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Prominent Mobile Actions (Add Expense & Lock & Finalize) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
            {!isFinalized && (isAdmin || isConfirmedAttendee) && (
              <button
                type="button"
                className="btn-primary primary-add-expense-btn"
                onClick={openAddExpenseModal}
                style={{
                  width: "100%",
                  background: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  fontSize: "0.92rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
                }}
              >
                <span>📸</span> + Add Shared Expense
              </button>
            )}
            {!isFinalized && isAdmin && (
              <button
                type="button"
                className="btn-secondary"
                disabled={actionBusy || (data?.balances.length ?? 0) === 0}
                onClick={() => setShowFinalizeModal(true)}
                style={{
                  width: "100%",
                  background: "#f8fafc",
                  color: "#1e293b",
                  border: "1px solid #cbd5e1",
                  padding: "0.6rem 1rem",
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.4rem",
                }}
              >
                🔒 Lock & Finalize Settlement
              </button>
            )}
          </div>

          {/* 3-Tab Segmented Mobile Navigation */}
          <div
            className="mobile-nav-pills"
            style={{
              display: "flex",
              background: "#e2e8f0",
              borderRadius: "8px",
              padding: "3px",
              gap: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveMobileTab("receipts")}
              style={{
                flex: 1,
                border: "none",
                background: activeMobileTab === "receipts" ? "#ffffff" : "transparent",
                color: activeMobileTab === "receipts" ? "#0f172a" : "#475569",
                padding: "0.5rem 0.25rem",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: activeMobileTab === "receipts" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                whiteSpace: "nowrap",
              }}
            >
              🧾 Receipts
            </button>
            <button
              type="button"
              onClick={() => setActiveMobileTab("campers")}
              style={{
                flex: 1,
                border: "none",
                background: activeMobileTab === "campers" ? "#ffffff" : "transparent",
                color: activeMobileTab === "campers" ? "#0f172a" : "#475569",
                padding: "0.5rem 0.25rem",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: activeMobileTab === "campers" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                whiteSpace: "nowrap",
              }}
            >
              👥 Campers
            </button>
            <button
              type="button"
              onClick={() => setActiveMobileTab("ledger")}
              style={{
                flex: 1,
                border: "none",
                background: activeMobileTab === "ledger" ? "#ffffff" : "transparent",
                color: activeMobileTab === "ledger" ? "#0f172a" : "#475569",
                padding: "0.5rem 0.25rem",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: activeMobileTab === "ledger" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                whiteSpace: "nowrap",
              }}
            >
              📊 Full Ledger
            </button>
          </div>
        </>
      )}

      {/* Desktop Settlement Status Header Card */}
      {!isMobile && (
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
      )}

      {/* TAB PANEL 1: RECEIPTS & EXPENSES (Mobile Tab) */}
      {isMobile && activeMobileTab === "receipts" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>🧾 Receipts & Shared Expenses</h3>
              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
                Itemized breakdown across shared groceries, website maintenance fee, and carpool reimbursements.
              </p>
            </div>
            {!isFinalized && (isAdmin || isConfirmedAttendee) && !isMobile && (
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
            {/* Shared Member Receipts */}
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <h4 style={{ margin: "0.5rem 0 0 0", fontSize: "0.95rem", color: "#334155" }}>🧾 Shared Member Receipts</h4>
              {(!data?.expenses || data.expenses.filter((e) => e.expenseType !== "website_maintenance").length === 0) ? (
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b", fontStyle: "italic" }}>
                  No shared receipts submitted yet.
                </p>
              ) : (
                (data.expenses ?? []).filter((e) => e.expenseType !== "website_maintenance").map((exp) => (
                  <div
                    key={exp.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "0.85rem 1rem",
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
                      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                          <strong style={{ fontSize: "0.9rem", wordBreak: "break-word" }}>{exp.description}</strong>
                          {exp.splitMode === "all_attendees" ? (
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
                              👥 Custom Split ({(exp.allocations ?? []).length} campers)
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
                          Paid by {exp.payerName} on {exp.incurredDate} • Split among {(exp.allocations ?? []).length} members
                          {exp.splitMode === "all_attendees" && " (auto-includes new attendees)"}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-start" }}>
                        {!isFinalized && (isAdmin || exp.payerMemberId === currentMemberId) && (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={actionBusy}
                            onClick={() => handleOpenEditExpense(exp)}
                            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "6px" }}
                            title="Edit expense details and participant split"
                            aria-label={`Edit ${exp.description}`}
                          >
                            ✏️ Edit
                          </button>
                        )}
                        {!isFinalized && (isAdmin || exp.payerMemberId === currentMemberId) && (
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
                            className="btn-secondary"
                            disabled={actionBusy}
                            onClick={() => handleDeleteExpense(exp.id)}
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.2rem 0.5rem",
                              borderRadius: "6px",
                              color: "#dc2626",
                              borderColor: "#fecaca",
                              background: "#fef2f2",
                            }}
                            title="Delete this expense"
                            aria-label={`Delete ${exp.description}`}
                          >
                            🗑️ Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {(exp.allocations ?? []).length > 0 && (
                      <details style={{ marginTop: "0.45rem" }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "#2563eb", fontWeight: 600 }}>
                          👥 View split details ({exp.allocations.length} campers)
                        </summary>
                        <div style={{ marginTop: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                          {exp.allocations.map((a) => (
                            <span
                              key={a.memberId}
                              style={{
                                fontSize: "0.74rem",
                                background: a.memberId === currentMemberId ? "#dbeafe" : "#f8fafc",
                                color: a.memberId === currentMemberId ? "#1e40af" : "#334155",
                                padding: "0.15rem 0.4rem",
                                borderRadius: "4px",
                                border: "1px solid",
                                borderColor: a.memberId === currentMemberId ? "#bfdbfe" : "#e2e8f0",
                                fontWeight: a.memberId === currentMemberId ? 600 : 400,
                              }}
                            >
                              {a.memberName}: {formatMoney(a.allocatedCents)}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Website Build & Maintenance Contribution */}
            {(data?.expenses ?? []).filter((e) => e.expenseType === "website_maintenance").length > 0 && (
              <div style={{ display: "grid", gap: "0.5rem" }}>
                <h4 style={{ margin: "0.5rem 0 0 0", fontSize: "0.95rem", color: "#334155" }}>
                  🌐 Website Build & Maintenance Contribution
                </h4>
                {(data?.expenses ?? [])
                  .filter((e) => e.expenseType === "website_maintenance")
                  .map((we) => {
                    const isFirstEvent = !we.description.includes("2.50") && !we.description.includes("Returning");
                    return (
                      <div
                        key={we.id}
                        style={{
                          border: "1px solid #c7d2fe",
                          borderRadius: "8px",
                          padding: "0.85rem 1rem",
                          background: "#f5f7ff",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                              <strong style={{ fontSize: "0.9rem", color: "#1e1b4b" }}>{we.description}</strong>
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
                                {isFirstEvent ? "$5.00 / First Event" : "$2.50 / Subsequent Event"}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: "0.2rem" }}>
                              Credited to {we.payerName || "Veerraju Amanchi"} • Fixed contribution across {(we.allocations ?? []).length} campers
                            </div>
                          </div>
                          <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#3730a3", whiteSpace: "nowrap" }}>
                            {formatMoney(we.amountCents)}
                          </span>
                        </div>
                        {(we.allocations ?? []).length > 0 && (
                          <details style={{ marginTop: "0.5rem" }}>
                            <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "#4338ca", fontWeight: 600 }}>
                              👥 View camper breakdown ({we.allocations.length} campers)
                            </summary>
                            <div style={{ marginTop: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                              {we.allocations.map((a) => (
                                <span
                                  key={a.memberId}
                                  style={{
                                    fontSize: "0.74rem",
                                    background: a.memberId === currentMemberId ? "#c7d2fe" : "#ffffff",
                                    color: a.memberId === currentMemberId ? "#1e1b4b" : "#334155",
                                    padding: "0.15rem 0.4rem",
                                    borderRadius: "4px",
                                    border: "1px solid #e0e7ff",
                                    fontWeight: a.memberId === currentMemberId ? 600 : 400,
                                  }}
                                >
                                  {a.memberName}: {formatMoney(a.allocatedCents)}
                                </span>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })}
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
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
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
                    {(cpr.allocations ?? []).length > 0 && (
                      <details style={{ marginTop: "0.45rem" }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "#2563eb", fontWeight: 600 }}>
                          👥 View split details ({cpr.allocations.length} occupants)
                        </summary>
                        <div style={{ marginTop: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                          {cpr.allocations.map((a) => (
                            <span
                              key={a.memberId}
                              style={{
                                fontSize: "0.74rem",
                                background: a.memberId === currentMemberId ? "#dbeafe" : "#f8fafc",
                                color: a.memberId === currentMemberId ? "#1e40af" : "#334155",
                                padding: "0.15rem 0.4rem",
                                borderRadius: "4px",
                                border: "1px solid",
                                borderColor: a.memberId === currentMemberId ? "#bfdbfe" : "#e2e8f0",
                                fontWeight: a.memberId === currentMemberId ? 600 : 400,
                              }}
                            >
                              {a.memberName}: {formatMoney(a.allocatedCents)}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB PANEL 4: FULL LEDGER (MATHEMATICAL AUDIT) */}
      {(!isMobile || activeMobileTab === "ledger") && (
        /* 3. Unified Expense Ledger */
        <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>📋 Unified Expense Ledger</h3>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              Comprehensive itemized breakdown across cabin advance, carpools, and shared receipts.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {!isFinalized && (isAdmin || isConfirmedAttendee) && !isMobile && (
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
        </div>

        {/* Spreadsheet-Style Matrix View */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.78rem", color: "#64748b", flexWrap: "wrap", gap: "0.5rem" }}>
            <span>👈 <em>Swipe horizontally to see all camper columns</em> 👉</span>
          </div>
            <div
              style={{
                position: "relative",
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: "560px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "#ffffff",
                boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
                WebkitOverflowScrolling: "touch",
                overscrollBehaviorX: "contain",
              }}
            >
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: "0.85rem",
                textAlign: "left",
              }}
            >
              <thead>
                <tr>
                  {/* Top-Left Header Cell (Unfrozen on mobile for smooth full-width sliding) */}
                  <th
                    style={{
                      position: !isMobile ? "sticky" : undefined,
                      top: 0,
                      left: !isMobile ? 0 : undefined,
                      zIndex: !isMobile ? 30 : 20,
                      background: "#f1f5f9",
                      padding: "0.75rem 0.85rem",
                      fontWeight: 700,
                      color: "#1e293b",
                      borderBottom: "2px solid #cbd5e1",
                      borderRight: "2px solid #cbd5e1",
                      minWidth: isMobile ? "140px" : "260px",
                      maxWidth: isMobile ? "180px" : "320px",
                      boxShadow: !isMobile ? "2px 0 4px -1px rgba(0,0,0,0.08)" : undefined,
                    }}
                  >
                    Expense Item & Payer
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 20,
                      background: "#f8fafc",
                      padding: "0.75rem 0.85rem",
                      fontWeight: 700,
                      color: "#1e293b",
                      borderBottom: "2px solid #cbd5e1",
                      borderRight: "1px solid #e2e8f0",
                      textAlign: "right",
                      minWidth: "95px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Total
                  </th>
                  {matrixMembers.map((m) => (
                    <th
                      key={m.memberId}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 20,
                        background: m.isMe ? "#eff6ff" : "#f8fafc",
                        padding: "0.75rem 0.85rem",
                        fontWeight: 700,
                        color: m.isMe ? "#1d4ed8" : "#1e293b",
                        borderBottom: "2px solid #cbd5e1",
                        borderRight: "1px solid #e2e8f0",
                        textAlign: "right",
                        minWidth: "120px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <div>{m.displayName}</div>
                      {m.isMe && (
                        <span
                          style={{
                            display: "inline-block",
                            fontSize: "0.68rem",
                            background: "#dbeafe",
                            color: "#1e40af",
                            padding: "0.05rem 0.35rem",
                            borderRadius: "4px",
                            fontWeight: 600,
                            marginTop: "0.15rem",
                          }}
                        >
                          You
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={matrixMembers.length + 2}
                      style={{ padding: "2.5rem 1rem", textAlign: "center", color: "#64748b", fontStyle: "italic" }}
                    >
                      No expenses recorded yet.
                    </td>
                  </tr>
                ) : (
                  matrixRows.map((row, idx) => {
                    const isEven = idx % 2 === 0;
                    const rowBg = isEven ? "#ffffff" : "#f8fafc";
                    return (
                      <tr key={row.id} style={{ background: rowBg }}>
                        {/* Left Expense Header Cell (Unfrozen on mobile for smooth full-width sliding) */}
                        <td
                          style={{
                            position: !isMobile ? "sticky" : undefined,
                            left: !isMobile ? 0 : undefined,
                            zIndex: !isMobile ? 10 : undefined,
                            background: rowBg,
                            padding: "0.65rem 0.85rem",
                            borderBottom: "1px solid #e2e8f0",
                            borderRight: "2px solid #cbd5e1",
                            minWidth: isMobile ? "140px" : "260px",
                            maxWidth: isMobile ? "180px" : "320px",
                            boxShadow: !isMobile ? "2px 0 4px -1px rgba(0,0,0,0.08)" : undefined,
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                              <strong style={{ fontSize: "0.88rem", color: "#0f172a" }}>{row.title}</strong>
                              <span
                                style={{
                                  background: row.tagStyle.bg,
                                  color: row.tagStyle.color,
                                  border: `1px solid ${row.tagStyle.border}`,
                                  fontSize: "0.7rem",
                                  padding: "0.1rem 0.4rem",
                                  borderRadius: "9999px",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {row.tagLabel}
                              </span>
                            </div>

                            <div style={{ fontSize: "0.76rem", color: "#64748b" }}>
                              Paid by <strong>{row.payerName}</strong>
                              {row.date ? ` • ${row.date}` : ""}
                            </div>

                            {/* Quick action buttons on matrix row */}
                            {row.rawExpense && (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.2rem", flexWrap: "wrap" }}>
                                {(row.rawExpense.receiptStoragePath || row.rawExpense.receiptUrl) && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReceiptViewer(row.rawExpense!)}
                                    aria-label="View Receipt"
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      padding: 0,
                                      fontSize: "0.74rem",
                                      color: "#2563eb",
                                      textDecoration: "underline",
                                      cursor: "pointer",
                                    }}
                                  >
                                    📄 View Receipt
                                  </button>
                                )}
                                {!isFinalized && (isAdmin || row.rawExpense.payerMemberId === currentMemberId) && (
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => handleOpenEditExpense(row.rawExpense!)}
                                    style={{
                                      background: "#f1f5f9",
                                      border: "1px solid #cbd5e1",
                                      borderRadius: "4px",
                                      padding: "0.15rem 0.4rem",
                                      fontSize: "0.72rem",
                                      cursor: "pointer",
                                    }}
                                    title="Edit expense details and participant split"
                                    aria-label={`Edit ${row.rawExpense.description}`}
                                  >
                                    ✏️ Edit
                                  </button>
                                )}
                                {!isFinalized && (isAdmin || row.rawExpense.payerMemberId === currentMemberId) && row.rawExpense.expenseType !== "website_maintenance" && (
                                  row.rawExpense.splitMode === "all_attendees" ? (
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      disabled={actionBusy}
                                      onClick={() => handleToggleExpenseSplitMode(row.rawExpense!.id, "custom")}
                                      style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem", borderRadius: "4px" }}
                                      title="Convert to fixed static allocations for current attendees"
                                    >
                                      Make Custom 🎯
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      disabled={actionBusy}
                                      onClick={() => handleToggleExpenseSplitMode(row.rawExpense!.id, "all_attendees")}
                                      style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem", borderRadius: "4px" }}
                                      title="Convert to dynamic split across all confirmed attendees"
                                    >
                                      Make Dynamic 🌐
                                    </button>
                                  )
                                )}
                                {!isFinalized && (isAdmin || row.rawExpense.payerMemberId === currentMemberId) && (
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => handleDeleteExpense(row.rawExpense!.id)}
                                    style={{
                                      background: "#fef2f2",
                                      border: "1px solid #fecaca",
                                      color: "#dc2626",
                                      borderRadius: "4px",
                                      padding: "0.15rem 0.4rem",
                                      fontSize: "0.72rem",
                                      cursor: "pointer",
                                    }}
                                    title="Delete this expense"
                                    aria-label={`Delete ${row.rawExpense.description}`}
                                  >
                                    🗑️ Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Total Column */}
                        <td
                          style={{
                            padding: "0.65rem 0.85rem",
                            borderBottom: "1px solid #e2e8f0",
                            borderRight: "1px solid #e2e8f0",
                            textAlign: "right",
                            fontWeight: 700,
                            color: row.category === "cabin" ? "#166534" : "#0f172a",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.category === "cabin" ? `-${formatMoney(row.totalCents)}` : formatMoney(row.totalCents)}
                        </td>

                        {/* Member Allocation Cells */}
                        {matrixMembers.map((m) => {
                          const allocated = row.allocationsMap.get(m.memberId);
                          const isPayer = m.memberId === row.payerMemberId;
                          return (
                            <td
                              key={m.memberId}
                              style={{
                                padding: "0.65rem 0.85rem",
                                borderBottom: "1px solid #e2e8f0",
                                borderRight: "1px solid #e2e8f0",
                                textAlign: "right",
                                whiteSpace: "nowrap",
                                background: m.isMe ? (isEven ? "#f8fafc" : "#f1f5f9") : undefined,
                              }}
                            >
                              {allocated !== undefined ? (
                                <div>
                                  <span style={{ fontWeight: 600, color: row.category === "cabin" ? "#166534" : "#1e293b" }}>
                                    {row.category === "cabin" ? `-${formatMoney(allocated)}` : formatMoney(allocated)}
                                  </span>
                                  {isPayer && row.category !== "cabin" && (
                                    <div style={{ fontSize: "0.68rem", color: "#166534", fontWeight: 700, marginTop: "0.1rem" }}>
                                      (Paid)
                                    </div>
                                  )}
                                  {row.category === "cabin" && (
                                    <div style={{ fontSize: "0.68rem", color: "#166534", fontWeight: 700, marginTop: "0.1rem" }}>
                                      (Prepaid)
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.8rem" }}>
                                  N/A
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                {/* Total Share Owed */}
                <tr style={{ background: "#f8fafc", borderTop: "2px solid #cbd5e1" }}>
                  <td
                    style={{
                      position: !isMobile ? "sticky" : undefined,
                      left: !isMobile ? 0 : undefined,
                      zIndex: !isMobile ? 10 : undefined,
                      background: "#f1f5f9",
                      padding: "0.65rem 0.85rem",
                      fontWeight: 700,
                      color: "#334155",
                      borderRight: "2px solid #cbd5e1",
                      borderBottom: "1px solid #e2e8f0",
                      minWidth: isMobile ? "140px" : "260px",
                      maxWidth: isMobile ? "180px" : "320px",
                      boxShadow: !isMobile ? "2px 0 4px -1px rgba(0,0,0,0.08)" : undefined,
                    }}
                  >
                    Total Share Owed
                  </td>
                  <td
                    style={{
                      padding: "0.65rem 0.85rem",
                      borderRight: "1px solid #e2e8f0",
                      borderBottom: "1px solid #e2e8f0",
                      textAlign: "right",
                      fontWeight: 700,
                      color: "#0f172a",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatMoney(matrixRows.reduce((sum, r) => sum + r.totalCents, 0))}
                  </td>
                  {matrixMembers.map((m) => {
                    const balance = balancesMap.get(m.memberId);
                    const allocatedSum = balance ? balance.totalAllocatedCents : matrixRows.reduce((sum, r) => sum + (r.allocationsMap.get(m.memberId) ?? 0), 0);
                    return (
                      <td
                        key={m.memberId}
                        style={{
                          padding: "0.65rem 0.85rem",
                          borderRight: "1px solid #e2e8f0",
                          borderBottom: "1px solid #e2e8f0",
                          textAlign: "right",
                          fontWeight: 700,
                          color: "#1e293b",
                          whiteSpace: "nowrap",
                          background: m.isMe ? "#eff6ff" : undefined,
                        }}
                      >
                        {formatMoney(allocatedSum)}
                      </td>
                    );
                  })}
                </tr>

                {/* Paid Out-of-Pocket */}
                <tr style={{ background: "#f8fafc" }}>
                  <td
                    style={{
                      position: !isMobile ? "sticky" : undefined,
                      left: !isMobile ? 0 : undefined,
                      zIndex: !isMobile ? 10 : undefined,
                      background: "#f1f5f9",
                      padding: "0.65rem 0.85rem",
                      fontWeight: 700,
                      color: "#334155",
                      borderRight: "2px solid #cbd5e1",
                      borderBottom: "1px solid #e2e8f0",
                      minWidth: isMobile ? "140px" : "260px",
                      maxWidth: isMobile ? "180px" : "320px",
                      boxShadow: !isMobile ? "2px 0 4px -1px rgba(0,0,0,0.08)" : undefined,
                    }}
                  >
                    Paid Out-of-Pocket
                  </td>
                  <td
                    style={{
                      padding: "0.65rem 0.85rem",
                      borderRight: "1px solid #e2e8f0",
                      borderBottom: "1px solid #e2e8f0",
                      textAlign: "right",
                      fontWeight: 700,
                      color: "#0f172a",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatMoney(matrixRows.reduce((sum, r) => sum + r.totalCents, 0))}
                  </td>
                  {matrixMembers.map((m) => {
                    const balance = balancesMap.get(m.memberId);
                    const paidSum = balance ? balance.totalPaidCents : 0;
                    return (
                      <td
                        key={m.memberId}
                        style={{
                          padding: "0.65rem 0.85rem",
                          borderRight: "1px solid #e2e8f0",
                          borderBottom: "1px solid #e2e8f0",
                          textAlign: "right",
                          fontWeight: 700,
                          color: paidSum > 0 ? "#166534" : "#64748b",
                          whiteSpace: "nowrap",
                          background: m.isMe ? "#eff6ff" : undefined,
                        }}
                      >
                        {formatMoney(paidSum)}
                      </td>
                    );
                  })}
                </tr>

                {/* Net Settlement Position */}
                <tr style={{ background: "#f1f5f9", borderTop: "2px solid #94a3b8" }}>
                  <td
                    style={{
                      position: !isMobile ? "sticky" : undefined,
                      left: !isMobile ? 0 : undefined,
                      zIndex: !isMobile ? 10 : undefined,
                      background: "#e2e8f0",
                      padding: "0.75rem 0.85rem",
                      fontWeight: 800,
                      color: "#0f172a",
                      borderRight: "2px solid #cbd5e1",
                      minWidth: isMobile ? "140px" : "260px",
                      maxWidth: isMobile ? "180px" : "320px",
                      boxShadow: !isMobile ? "2px 0 4px -1px rgba(0,0,0,0.08)" : undefined,
                    }}
                  >
                    Net Settlement Position
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 0.85rem",
                      borderRight: "1px solid #cbd5e1",
                      textAlign: "right",
                      fontWeight: 700,
                      color: "#64748b",
                      whiteSpace: "nowrap",
                    }}
                  >
                    $0.00
                  </td>
                  {matrixMembers.map((m) => {
                    const balance = balancesMap.get(m.memberId);
                    const net = balance ? balance.netBalanceCents : 0;
                    const isPositive = net > 0;
                    const isNegative = net < 0;
                    return (
                      <td
                        key={m.memberId}
                        style={{
                          padding: "0.75rem 0.85rem",
                          borderRight: "1px solid #cbd5e1",
                          textAlign: "right",
                          fontWeight: 800,
                          color: isPositive ? "#166534" : isNegative ? "#dc2626" : "#64748b",
                          whiteSpace: "nowrap",
                          background: m.isMe ? "#dbeafe" : undefined,
                        }}
                      >
                        {isPositive ? `+${formatMoney(net)}` : isNegative ? `-${formatMoney(Math.abs(net))}` : "$0.00"}
                        <div style={{ fontSize: "0.68rem", fontWeight: 600 }}>
                          {isPositive ? "(Gets back)" : isNegative ? "(Owes)" : "(Settled)"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    )}

      {/* TAB PANEL 2: CAMPERS & SETTLEMENT */}
      {(!isMobile || activeMobileTab === "campers") && (
        <>
          {/* 1. Settlement Transfers */}
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
                {(data?.transfers ?? []).map((tx) => {
                  const isPayer = tx.isPayer || tx.payerMemberId === currentMemberId;
                  const isRecipient = tx.isRecipient || tx.recipientMemberId === currentMemberId;
                  const isConfirmed = tx.status === "confirmed";
                  const isSent = tx.status === "sent";

                  return (
                    <div
                      key={tx.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.6rem",
                        padding: "0.9rem 1rem",
                        borderRadius: "8px",
                        border: "1px solid",
                        borderColor: isConfirmed ? "#a7f3d0" : isSent ? "#fde68a" : "#e2e8f0",
                        background: isConfirmed ? "#f0fdf4" : isSent ? "#fefce8" : "#fff",
                      }}
                    >
                      {/* Top Row: Who -> Whom & Amount */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", fontSize: "0.95rem" }}>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>
                            {tx.payerName} {isPayer && <span style={{ color: "#2563eb", fontWeight: 700 }}>(You)</span>}
                          </span>
                          <span style={{ color: "#64748b" }}>➔</span>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>
                            {tx.recipientName} {isRecipient && <span style={{ color: "#2563eb", fontWeight: 700 }}>(You)</span>}
                          </span>
                        </div>
                        <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#0f172a" }}>
                          {formatMoney(tx.amountCents)}
                        </span>
                      </div>

                      {/* Payment Method / Note */}
                      <div style={{ fontSize: "0.82rem", color: "#475569" }}>
                        <span>Preferred: <strong>{tx.recipientPreferredMethod || "Direct Transfer"}</strong></span>
                        {tx.notes && <span style={{ marginLeft: "0.5rem", color: "#64748b" }}>• Note: "{tx.notes}"</span>}
                      </div>

                      {/* Status Badge */}
                      <div>
                        {isConfirmed ? (
                          <span style={{ display: "inline-block", background: "#dcfce7", color: "#166534", fontSize: "0.78rem", padding: "0.2rem 0.55rem", borderRadius: "6px", fontWeight: 600 }}>
                            ✅ Confirmed Received
                          </span>
                        ) : isSent ? (
                          <span style={{ display: "inline-block", background: "#fef9c3", color: "#854d0e", fontSize: "0.78rem", padding: "0.2rem 0.55rem", borderRadius: "6px", fontWeight: 600 }}>
                            🟡 Sent ({tx.paymentMethod ?? "Transfer"}) · Awaiting Confirmation
                          </span>
                        ) : (
                          <span style={{ display: "inline-block", background: "#fee2e2", color: "#991b1b", fontSize: "0.78rem", padding: "0.2rem 0.55rem", borderRadius: "6px", fontWeight: 600 }}>
                            🔴 Outstanding
                          </span>
                        )}
                      </div>

                      {/* Action buttons (Left-aligned) */}
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-start", marginTop: "0.2rem" }}>
                        <button
                          type="button"
                          onClick={() => {
                            const details = `Send ${formatMoney(tx.amountCents)} to ${tx.recipientName} via ${tx.recipientPreferredMethod}${tx.notes ? ` (Note: ${tx.notes})` : ""}`;
                            navigator.clipboard?.writeText(details);
                            setCopySuccess(true);
                            setTimeout(() => setCopySuccess(false), 2000);
                          }}
                          style={{
                            background: "#f1f5f9",
                            color: "#334155",
                            border: "1px solid #cbd5e1",
                            padding: "0.35rem 0.65rem",
                            borderRadius: "6px",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          📋 Copy Details
                        </button>

                        {isFinalized && !isConfirmed && (
                          <>
                            {(isPayer || isAdmin) && !isSent && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => {
                                  setSelectedTransfer(tx);
                                  setShowMarkSentModal(true);
                                }}
                                style={{ background: "#2563eb", color: "#fff", border: "none", padding: "0.35rem 0.75rem", borderRadius: "6px", fontSize: "0.78rem", cursor: "pointer", fontWeight: 600 }}
                              >
                                ✓ Mark Sent
                              </button>
                            )}

                            {(isRecipient || isAdmin) && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => handleConfirmReceived(tx.id)}
                                style={{ background: "#10b981", color: "#fff", border: "none", padding: "0.35rem 0.75rem", borderRadius: "6px", fontSize: "0.78rem", cursor: "pointer", fontWeight: 600 }}
                              >
                                {isAdmin && !isRecipient ? "Confirm (Admin)" : "Confirm Received"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Campers & Balances */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>👥 Campers & Balances</h3>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              Individual breakdown of expenses paid, fair share owed, and final net settlement.
            </p>
          </div>
          <span style={{ fontSize: "0.8rem", color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.2rem 0.5rem", borderRadius: "4px", fontWeight: 500 }}>
            ✓ Verified $50 deposits are credited, reducing your settlement amount
          </span>
        </div>

        {/* Quick Camper Balance Cards (Mobile-first vertical stack) */}
        <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1.25rem" }}>
          {(data?.balances ?? []).map((b) => {
            const isMe = b.isMe || b.memberId === currentMemberId;
            const netCents = b.netBalanceCents;
            const owes = netCents < 0;
            const gets = netCents > 0;
            return (
              <div
                key={`camper-card-${b.memberId}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.75rem 0.85rem",
                  borderRadius: "8px",
                  border: isMe ? "1.5px solid #93c5fd" : "1px solid #e2e8f0",
                  background: isMe ? "#f0f7ff" : "#ffffff",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem", color: isMe ? "#1e40af" : "#1e293b" }}>
                    <span>{b.displayName}</span> {isMe && <span style={{ color: "#2563eb", fontSize: "0.8rem", fontWeight: 700 }}>• You</span>}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: "0.15rem" }}>
                    Paid: <strong style={{ color: "#334155" }}>{formatMoney(b.totalPaidCents)}</strong> • Fair Share: <strong style={{ color: "#334155" }}>{formatMoney(b.totalAllocatedCents)}</strong>
                  </div>
                  {(b.depositPaidCents ?? 0) > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "#166534" }}>
                      Incl. {formatMoney(b.depositPaidCents!)} advance deposit
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.25rem 0.6rem",
                      borderRadius: "9999px",
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      background: owes ? "#fee2e2" : gets ? "#dcfce7" : "#f1f5f9",
                      color: owes ? "#991b1b" : gets ? "#166534" : "#475569",
                      border: owes ? "1px solid #fecaca" : gets ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                    }}
                  >
                    {gets ? `+${formatMoney(netCents)}` : owes ? `Owes ${formatMoney(Math.abs(netCents))}` : "$0.00 Settled"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detailed Table Breakdown */}
        <div style={{ overflowX: "auto", borderTop: "1px solid #e2e8f0", paddingTop: "0.75rem" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Detailed Table Breakdown
          </h4>
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
              {(data?.balances ?? []).map((b) => {
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
    </>
    )}

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
                    inputMode="decimal"
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
                  capture="environment"
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
                {isAdmin ? (
                  <select value={editPayerId} onChange={(e) => setEditPayerId(e.target.value)}>
                    {attendeesList.map((att) => (
                      <option key={att.memberId} value={att.memberId}>
                        {att.displayName} {att.memberId === currentMemberId ? "(You)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    disabled
                    readOnly
                    value={
                      attendeesList.find((a) => a.memberId === (editPayerId || editingExpense.payerMemberId))?.displayName ||
                      (editingExpense.payerMemberId === currentMemberId ? "You" : "Camper")
                    }
                    style={{ background: "#f8fafc", color: "#64748b", cursor: "not-allowed" }}
                  />
                )}
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

              {/* Split Mode Options */}
              <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.25rem" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1e293b" }}>Split Type</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.6rem 0.75rem",
                      border: editSplitMode === "all_attendees" ? "2px solid #2563eb" : "1px solid #cbd5e1",
                      borderRadius: "8px",
                      background: editSplitMode === "all_attendees" ? "#eff6ff" : "#ffffff",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                    }}
                  >
                    <input
                      type="radio"
                      name="editSplitMode"
                      value="all_attendees"
                      checked={editSplitMode === "all_attendees"}
                      onChange={() => setEditSplitMode("all_attendees")}
                    />
                    <span>🌐 All Attendees (Dynamic)</span>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.6rem 0.75rem",
                      border: editSplitMode === "custom" ? "2px solid #2563eb" : "1px solid #cbd5e1",
                      borderRadius: "8px",
                      background: editSplitMode === "custom" ? "#eff6ff" : "#ffffff",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                    }}
                  >
                    <input
                      type="radio"
                      name="editSplitMode"
                      value="custom"
                      checked={editSplitMode === "custom"}
                      onChange={() => setEditSplitMode("custom")}
                    />
                    <span>🎯 Custom Subset (Select Campers)</span>
                  </label>
                </div>
              </div>

              {editSplitMode === "all_attendees" ? (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "8px",
                    padding: "0.6rem 0.75rem",
                    fontSize: "0.85rem",
                    color: "#166534",
                  }}
                >
                  {(() => {
                    const previewAmountCents = Math.round((parseFloat(editDollars) || 0) * 100);
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
                        onClick={() => setEditSelectedParticipantIds(attendeesList.map((a) => a.memberId))}
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.8rem", padding: "0.25rem 0.65rem", borderRadius: "9999px" }}
                        onClick={() => setEditSelectedParticipantIds([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {editSelectedParticipantIds.length === attendeesList.length && attendeesList.length > 0 ? (
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "6px", padding: "0.4rem 0.65rem", fontSize: "0.8rem", color: "#166534", fontWeight: 500 }}>
                      🌐 All {attendeesList.length} campers selected — this expense will dynamically split across all attendees, including any new campers who join later.
                    </div>
                  ) : (
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "0.4rem 0.65rem", fontSize: "0.8rem", color: "#92400e" }}>
                      🎯 Custom subset: {editSelectedParticipantIds.length} of {attendeesList.length} campers selected (fixed split).
                    </div>
                  )}

                  <div
                    data-testid="edit-expense-split-list"
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
                      const isChecked = editSelectedParticipantIds.includes(att.memberId);
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
                                setEditSelectedParticipantIds((prev) => [...prev, att.memberId]);
                              } else {
                                setEditSelectedParticipantIds((prev) => prev.filter((id) => id !== att.memberId));
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
                    const previewAmountCents = Math.round((parseFloat(editDollars) || 0) * 100);
                    if (editSelectedParticipantIds.length > 0 && previewAmountCents > 0) {
                      const estPerPersonCents = Math.round(previewAmountCents / editSelectedParticipantIds.length);
                      return (
                        <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem", color: "#0369a1" }}>
                          Splitting equally among {editSelectedParticipantIds.length} participant{editSelectedParticipantIds.length > 1 ? "s" : ""}: ~{formatMoney(estPerPersonCents)} each.
                        </p>
                      );
                    }
                    return (
                      <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem", color: editSelectedParticipantIds.length === 0 ? "#dc2626" : "#64748b" }}>
                        {editSelectedParticipantIds.length === 0
                          ? "⚠️ Please select at least one participant."
                          : `Selected ${editSelectedParticipantIds.length} participant(s).`}
                      </p>
                    );
                  })()}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={actionBusy}
                  onClick={() => setEditingExpense(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={
                    actionBusy ||
                    (editSplitMode === "custom" && editSelectedParticipantIds.length === 0) ||
                    (editSplitMode === "all_attendees" && attendeesList.length === 0)
                  }
                >
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
