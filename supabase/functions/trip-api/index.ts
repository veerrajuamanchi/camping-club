import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveServiceApiKey } from "../_shared/service-key.mjs";
import { canonicalJson, keyedDigest, requestDigest, requiredEnv } from "../_shared/crypto.ts";
import { corsHeaders, isOriginAllowed, json, readBody } from "../_shared/http.ts";
import { computeSettlement, calculateEqualAllocations, type ExpenseInput, type ExternalPaymentInput } from "../_shared/settlementEngine.ts";

const service = createClient(requiredEnv("SUPABASE_URL"), resolveServiceApiKey(Deno.env.get("SUPABASE_SECRET_KEYS")), { auth: { persistSession: false, autoRefreshToken: false } });
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);
const structuredValues = z.record(z.string(), z.unknown());
const reason = z.string().trim().min(1).max(500);
const actionNames = [
  "get_calendar", "get_constitution", "get_trip_details", "get_trip_time_slots", "admin_configure_club", "admin_generate_calendar",
  "admin_reorder_campsites", "admin_update_campsite", "admin_create_campsite", "admin_configure_trip", "admin_set_poll_status",
  "admin_publish_rule", "admin_set_rule_override", "submit_rsvp", "admin_record_interest", "request_withdrawal",
  "admin_promote_from_waitlist", "admin_list_master_responsibilities", "admin_create_master_responsibility", "admin_update_master_responsibility",
  "admin_save_daily_responsibilities", "admin_generate_candidate_slots", "admin_configure_time_slot", "admin_create_custom_time_slot", "admin_add_slot_duty", "admin_update_slot_duty",
  "get_trip_task_matrix", "claim_duty", "drop_duty", "admin_assign_duty", "admin_reassign_duty", "admin_set_driver_credit",
  "admin_delete_trip", "admin_create_custom_trip", "admin_delete_campsite", "admin_set_daily_workload_target",
  "admin_transition_trip_lifecycle", "admin_update_cabin_reservation", "get_trip_lifecycle",
  "get_trip_logistics", "manage_trip_commitment", "manage_trip_commitments", "admin_manage_carpool", "record_carpool_mileage", "admin_override_duty",
  "get_trip_financials", "admin_manage_trip_expense", "admin_finalize_settlement", "update_settlement_transfer",
  "get_master_catalogs", "admin_manage_master_gear", "admin_manage_master_food", "admin_delete_master_responsibility",
  "submit_deposit", "verify_deposit", "save_meal_preferences", "admin_sync_trip_commitments",
  "get_trip_activities", "get_master_activities", "admin_manage_master_activity", "admin_manage_trip_activity",
  "set_activity_participation", "admin_manage_activity_pairings", "submit_activity_voucher",
  "request_partner_swap", "respond_partner_swap", "record_activity_waiver_click", "confirm_activity_waiver_signed",
] as const;
const requestSchema = z.object({ action: z.enum(actionNames), input: z.unknown().optional() }).strict();

const optionalUrl = z.string().trim()
  .transform((v) => {
    if (!v) return null;
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  })
  .pipe(z.string().url().nullable())
  .or(z.literal("").transform(() => null))
  .nullable()
  .optional()
  .default(null);

const inputSchemas = {
  admin_transition_trip_lifecycle: z.object({
    tripId: uuid,
    toStatus: z.enum([
      "rsvp_open", "confirmed", "in_progress", "completed",
      "financially_finalized", "financially_settled", "archived", "cancelled"
    ]),
    reason: reason.optional(),
    expectedVersion: z.number().int().positive().optional(),
  }).strict(),
  admin_update_cabin_reservation: z.object({
    tripId: uuid,
    status: z.enum([
      "not_booked", "booked", "pending", "sites_available",
      "no_vacancy", "cancellation_requested", "cancellation_confirmed", "unresolved"
    ]),
    reservationReference: z.string().trim().max(100).nullable().optional(),
    providerLabel: z.string().trim().max(100).nullable().optional(),
    paidByMemberId: uuid.nullable().optional(),
    reservationAmountCents: z.number().int().nonnegative().optional(),
    cabinCount: z.number().int().positive().optional(),
    perCabinCapacity: z.number().int().positive().optional(),
    cancellationNotes: z.string().max(2000).nullable().optional(),
  }).strict(),
  get_trip_lifecycle: z.object({ tripId: uuid }).strict(),
  get_trip_logistics: z.object({ tripId: uuid }).strict(),
  manage_trip_commitment: z.object({
    tripId: uuid,
    action: z.enum(["claim", "unclaim", "admin_create", "admin_update", "admin_delete", "toggle_active"]),
    commitmentId: uuid.optional(),
    isActive: z.boolean().optional(),
    commitmentType: z.enum(["individual_pack", "shared_volunteer"]).optional(),
    category: z.string().trim().optional(),
    itemName: z.string().trim().min(1).max(200).optional(),
    quantityDescription: z.string().trim().max(200).nullable().optional(),
    isCritical: z.boolean().optional(),
    assignedMemberId: uuid.nullable().optional(),
  }).strict(),
  manage_trip_commitments: z.object({
    tripId: uuid,
    action: z.enum(["toggle_active", "admin_create", "admin_update", "admin_delete", "claim", "unclaim"]),
    commitmentId: uuid.optional(),
    isActive: z.boolean().optional(),
    commitmentType: z.enum(["individual_pack", "shared_volunteer"]).optional(),
    category: z.string().trim().optional(),
    itemName: z.string().trim().min(1).max(200).optional(),
    quantityDescription: z.string().trim().max(200).nullable().optional(),
    isCritical: z.boolean().optional(),
    assignedMemberId: uuid.nullable().optional(),
  }).strict(),
  get_master_catalogs: z.object({
    includeInactive: z.boolean().optional(),
  }).strict().optional().default({}),
  admin_manage_master_gear: z.object({
    action: z.enum(["create", "update", "delete"]),
    id: uuid.optional(),
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    gearType: z.enum(["individual", "shared"]).optional(),
    category: z.enum(["shelter", "sleep", "kitchen", "lighting", "safety", "tools", "clothing", "other"]).optional(),
    defaultQuantity: z.string().trim().max(100).optional(),
    isCritical: z.boolean().optional(),
    active: z.boolean().optional(),
  }).strict(),
  admin_manage_master_food: z.object({
    action: z.enum(["create", "update", "delete"]),
    id: uuid.optional(),
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    category: z.enum(["pantry", "produce", "dairy_meat", "bakery", "beverages", "campfire", "supplies", "other"]).optional(),
    defaultQuantity: z.string().trim().max(100).optional(),
    isCritical: z.boolean().optional(),
    active: z.boolean().optional(),
  }).strict(),
  admin_delete_master_responsibility: z.object({
    id: uuid,
  }).strict(),
  submit_deposit: z.object({
    tripId: uuid,
  }).strict(),
  verify_deposit: z.object({
    tripId: uuid,
    memberId: uuid,
    status: z.enum(["unpaid", "submitted_by_member", "confirmed_by_admin", "exempt"]).optional().default("confirmed_by_admin"),
  }).strict(),
  admin_manage_carpool: z.object({
    tripId: uuid,
    action: z.enum(["admin_create_carpool", "admin_update_carpool", "admin_delete_carpool"]),
    carpoolId: uuid.optional(),
    driverMemberId: uuid.optional(),
    vehicleDescription: z.string().trim().min(1).max(200).optional(),
    maxSeats: z.number().int().min(1).max(20).optional(),
    startingMileage: z.number().nonnegative().nullable().optional(),
    endingMileage: z.number().nonnegative().nullable().optional(),
    departureDetails: z.string().trim().max(1000).nullable().optional(),
    riderMemberIds: z.array(uuid).optional(),
  }).strict(),
  record_carpool_mileage: z.object({
    tripId: uuid,
    carpoolId: uuid,
    startingMileage: z.number().nonnegative().nullable().optional(),
    endingMileage: z.number().nonnegative().nullable().optional(),
  }).strict(),
  admin_override_duty: z.object({
    tripId: uuid,
    dutyId: uuid,
    targetMemberId: uuid,
    action: z.enum(["assign", "unassign"]),
    reason: z.string().trim().max(500).optional(),
  }).strict(),
  get_trip_financials: z.object({ tripId: uuid }).strict(),
  admin_manage_trip_expense: z.object({
    tripId: uuid,
    action: z.enum(["create", "delete", "update"]),
    expenseId: uuid.optional(),
    expenseType: z.enum(["cabin_deposit", "carpool_mileage", "shared_receipt", "other"]).optional(),
    payerMemberId: uuid.optional(),
    amountCents: z.number().int().positive().optional(),
    description: z.string().trim().min(1).max(500).optional(),
    incurredDate: date.optional(),
    receiptUrl: optionalUrl,
    allocations: z.array(z.object({
      memberId: uuid,
      allocatedCents: z.number().int().nonnegative(),
    })).optional(),
    splitMode: z.enum(["all_attendees", "custom"]).optional(),
    receiptStoragePath: z.string().trim().nullable().optional(),
    receiptFileName: z.string().trim().nullable().optional(),
    receiptContentType: z.string().trim().nullable().optional(),
  }).strict(),
  admin_finalize_settlement: z.object({
    tripId: uuid,
    reason: reason.optional(),
  }).strict(),
  update_settlement_transfer: z.object({
    transferId: uuid,
    action: z.enum(["mark_sent", "confirm_received"]),
    paymentMethod: z.enum(["zelle", "venmo", "paypal", "apple_cash", "cash", "other"]).optional(),
    notes: z.string().trim().max(500).optional(),
  }).strict(),
  admin_set_daily_workload_target: z.object({ tripId: uuid, target: z.number().min(0.5).max(100).multipleOf(0.5).nullable(), expectedVersion: z.number().int().positive() }).strict(),
  get_calendar: z.object({}).strict(),
  get_constitution: z.object({ tripId: uuid.optional() }).strict(),
  save_meal_preferences: z.object({
    tripId: uuid,
    saturdayBeverage: z.enum(["coffee", "tea", "none"]),
    sundayBeverage: z.enum(["coffee", "tea", "none"]),
    defaultDiet: z.enum(["vegetarian", "non_vegetarian"]),
    mealChoices: z.record(z.string(), z.enum(["veg", "non_veg", "skip"])),
    allergiesNotes: z.string().trim().max(500).nullable().optional(),
    alcoholBeverages: z.array(z.string()).optional().default([]),
  }).strict(),
  get_trip_details: z.object({ tripId: uuid }).strict(),
  admin_sync_trip_commitments: z.object({ tripId: uuid }).strict(),
  get_trip_time_slots: z.object({ tripId: uuid }).strict(),
  admin_configure_club: z.object({
    timezone: z.string().trim().min(1).max(100), leadDays: z.number().int().min(1).max(120), closeTime: time.nullable(),
    defaultMinimumParticipants: z.number().int().min(1).max(100), nextRotationPosition: z.number().int().min(1), expectedVersion: z.number().int().positive(),
  }).strict(),
  admin_generate_calendar: z.object({ throughMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
  admin_reorder_campsites: z.object({ order: z.array(uuid).min(7), nextRotationPosition: z.number().int().min(1), reason }).strict(),
  admin_create_campsite: z.object({
    name: z.string().trim().min(1).max(120),
    availabilityUrl: optionalUrl,
    locationDescription: z.string().max(2000),
    directions: z.string().max(8000).nullable().optional(),
    cabinCapacity: z.number().int().nonnegative().nullable().optional(),
    cabinTypes: z.array(z.string().trim().min(1).max(100)).max(20).nullable().optional().default([]),
    reservationInstructions: z.string().max(8000).nullable().optional(),
    estimatedRateCents: z.number().int().nonnegative().nullable().optional(),
    availabilityStatus: z.enum(["available", "limited", "unavailable", "unknown", "manual_confirmation"]).optional().default("available"),
    availabilitySourceUrl: optionalUrl,
    imageUrl: optionalUrl,
    campHostName: z.string().trim().max(120).nullable().optional(),
    campHostPhone: z.string().trim().max(40).nullable().optional(),
    campFeatures: z.array(z.string().trim().min(1).max(300)).max(50).optional().default([]),
    cabinInformation: z.string().max(8000).nullable().optional(),
    siteAvailability: z.enum(["open_year_round", "closed_for_winter", "Open Year-Round", "Closed for Winter"]).transform((v) => {
      if (v === "Closed for Winter" || v === "closed_for_winter") return "closed_for_winter";
      return "open_year_round";
    }).optional().default("open_year_round"),
    peakSeasonTimeframe: z.string().trim().max(50).nullable().optional(),
    peakSeasonBookingRequirement: z.string().trim().max(30).nullable().optional(),
    adminNotes: z.string().max(4000).optional().default(""),
    reason: reason.optional().default("Administrator created campsite"),
  }).strict(),
  admin_update_campsite: z.object({
    campsiteId: uuid,
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    availabilityUrl: optionalUrl,
    locationDescription: z.string().max(2000),
    directions: z.string().max(8000).nullable().optional(),
    cabinCapacity: z.number().int().nonnegative().nullable().optional(),
    cabinTypes: z.array(z.string().trim().min(1).max(100)).max(20).nullable().optional().default([]),
    reservationInstructions: z.string().max(8000).nullable().optional(),
    estimatedRateCents: z.number().int().nonnegative().nullable().optional(),
    availabilityStatus: z.enum(["available", "limited", "unavailable", "unknown", "manual_confirmation"]).optional().default("available"),
    availabilitySourceUrl: optionalUrl,
    availabilityVerifiedAt: z.string().nullable().optional(),
    imageUrl: optionalUrl,
    campHostName: z.string().trim().max(120).nullable().optional(),
    campHostPhone: z.string().trim().max(40).nullable().optional(),
    campFeatures: z.array(z.string().trim().min(1).max(300)).max(50).optional().default([]),
    cabinInformation: z.string().max(8000).nullable().optional(),
    siteAvailability: z.enum(["open_year_round", "closed_for_winter", "Open Year-Round", "Closed for Winter"]).transform((v) => {
      if (v === "Closed for Winter" || v === "closed_for_winter") return "closed_for_winter";
      return "open_year_round";
    }).optional().default("open_year_round"),
    peakSeasonTimeframe: z.string().trim().max(50).nullable().optional(),
    peakSeasonBookingRequirement: z.string().trim().max(30).nullable().optional(),
    adminNotes: z.string().max(4000).optional().default(""),
    reason: reason.optional().default("Administrator updated campsite"),
  }).strict(),
  admin_delete_campsite: z.object({
    campsiteId: uuid,
    reason: reason.optional().default("Administrator deleted campsite"),
  }).strict(),
  admin_configure_trip: z.object({
    tripId: uuid, startsOn: date, endsOn: date, deadlineDate: date.nullable(), deadlineTime: time.nullable(),
    minimumParticipants: z.number().int().min(1).max(100), maxCapacity: z.number().int().min(1).max(100).nullable(),
    cabinCount: z.number().int().min(1).max(50).nullable().optional(),
    perCabinCapacity: z.number().int().min(1).max(50).optional(),
    selectedCampsiteId: uuid, cabinBookingStatus: z.enum(["booked", "pending", "sites_available", "no_vacancy"]),
    additionalInformation: z.string().max(4000), expectedVersion: z.number().int().positive(), reason,
    title: z.string().trim().min(1).max(120).nullable().optional(),
    eventStatus: z.enum(["tentative", "confirmed", "cancelled"]).optional(),
    campingType: z.enum(["cabin", "tent", "rv", "boat"]).optional(),
    cabinPayerMemberId: uuid.nullable().optional(),
  }).strict(),
  admin_set_poll_status: z.object({ tripId: uuid, pollStatus: z.enum(["open", "closed"]), expectedVersion: z.number().int().positive(), reason }).strict(),
  admin_publish_rule: z.object({
    scope: z.enum(["general", "trip"]), tripId: uuid.nullable().optional(), stableKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/),
    category: z.enum(["participation", "transport", "cabin", "expenses", "lodging", "meals", "conduct", "custom"]),
    text: z.string().trim().min(1).max(8000), structuredValues, effectiveFrom: z.string().datetime(), expiresAt: z.string().datetime().nullable(), reason,
  }).strict(),
  admin_set_rule_override: z.object({
    tripId: uuid, baseRuleVersionId: uuid, text: z.string().trim().min(1).max(8000), structuredValues,
    expiresAt: z.string().datetime(), reason,
  }).strict(),
  submit_rsvp: z.object({
    tripId: uuid, response: z.enum(["coming", "not_coming"]), bundleId: uuid.optional(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(), expectedVersion: z.number().int().nonnegative(),
  }).strict(),
  admin_record_interest: z.object({
    tripId: uuid, memberId: uuid, response: z.enum(["coming", "not_coming"]), expectedVersion: z.number().int().nonnegative(), reason,
  }).strict(),
  request_withdrawal: z.object({ tripId: uuid, reason }).strict(),
  admin_promote_from_waitlist: z.object({ tripId: uuid, memberId: uuid, reason }).strict(),
  admin_list_master_responsibilities: z.object({ includeInactive: z.boolean().optional() }).strict(),
  admin_create_master_responsibility: z.object({
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    category: z.enum(["meal_prep", "cooking", "cleanup", "activities", "transport", "other"]),
    defaultCapacity: z.number().int().min(1).max(20),
    workloadWeight: z.number().min(0.5).max(5.0),
  }).strict(),
  admin_update_master_responsibility: z.object({
    id: uuid,
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    category: z.enum(["meal_prep", "cooking", "cleanup", "activities", "transport", "other"]),
    defaultCapacity: z.number().int().min(1).max(20),
    workloadWeight: z.number().min(0.5).max(5.0),
    active: z.boolean().optional(),
  }).strict(),
  admin_save_daily_responsibilities: z.object({ tripId: uuid, expectedVersion: z.number().int().positive(), confirmRemoval: z.boolean().default(false),
    days: z.array(z.object({ date, responsibilityIds: z.array(uuid).min(1) }).strict()).min(1) }).strict(),
  admin_generate_candidate_slots: z.object({
    tripId: uuid,
    regenerate: z.boolean().optional(),
  }).strict(),
  admin_configure_time_slot: z.object({
    slotId: uuid,
    label: z.string().trim().min(2).max(100).optional(),
    isEnabled: z.boolean().optional(),
  }).strict(),
  admin_create_custom_time_slot: z.object({
    tripId: uuid,
    slotDate: date,
    timeBlock: z.string().trim().min(2).max(50),
    slotType: z.enum(["meal", "chore", "activity", "general"]),
    label: z.string().trim().min(2).max(100),
  }).strict(),
  admin_add_slot_duty: z.object({
    timeSlotId: uuid,
    masterResponsibilityId: uuid,
    capacity: z.number().int().min(1).max(20),
    workloadWeight: z.number().min(0.5).max(5.0),
  }).strict(),
  admin_update_slot_duty: z.object({
    slotDutyId: uuid,
    capacity: z.number().int().min(1).max(20).optional(),
    workloadWeight: z.number().min(0.5).max(5.0).optional(),
    isActive: z.boolean().optional(),
  }).strict(),
  get_trip_task_matrix: z.object({
    tripId: uuid,
  }).strict(),
  claim_duty: z.object({
    slotDutyId: uuid,
    acknowledgeOverlap: z.boolean().optional(),
  }).strict(),
  drop_duty: z.object({
    assignmentId: uuid,
    reason: z.string().trim().max(500).optional(),
  }).strict(),
  admin_assign_duty: z.object({
    slotDutyId: uuid,
    memberId: uuid,
  }).strict(),
  admin_reassign_duty: z.object({
    assignmentId: uuid,
    newMemberId: uuid,
    reason: z.string().trim().max(500).optional(),
  }).strict(),
  admin_set_driver_credit: z.object({
    tripId: uuid,
    memberId: uuid,
    workloadCredit: z.number().min(0.1).max(5.0),
    status: z.enum(["approved", "revoked"]),
    notes: z.string().trim().max(500).optional(),
  }).strict(),
  admin_delete_trip: z.object({
    tripId: uuid,
    reason,
  }).strict(),
  admin_create_custom_trip: z.object({
    title: z.string().trim().min(2).max(120),
    startsOn: date,
    endsOn: date,
    selectedCampsiteId: uuid,
    campingType: z.enum(["cabin", "tent", "rv", "boat"]).optional().default("cabin"),
    sitesCount: z.number().int().min(1).max(50).optional().default(2),
    siteCapacity: z.number().int().min(1).max(50).optional().default(6),
    eventStatus: z.enum(["tentative", "confirmed", "cancelled"]).optional().default("tentative"),
    cabinBookingStatus: z.enum(["booked", "pending", "sites_available", "no_vacancy"]).optional(),
    bookingStatus: z.enum(["booked", "pending", "sites_available", "no_vacancy"]).optional(),
    minimumParticipants: z.number().int().min(1).max(100).optional().default(4),
    maxCapacity: z.number().int().min(1).max(100).nullable().optional(),
    deadlineDate: date.nullable().optional(),
    deadlineTime: time.nullable().optional(),
    additionalInformation: z.string().max(4000).optional().default(""),
    reason,
  }).strict(),
  get_trip_activities: z.object({
    tripId: uuid,
  }).strict(),
  get_master_activities: z.object({
    includeInactive: z.boolean().optional(),
  }).strict().optional().default({}),
  admin_manage_master_activity: z.object({
    action: z.enum(["create", "update", "delete"]),
    id: uuid.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().max(100).optional(),
    imageUrl: optionalUrl,
    locationName: z.string().trim().max(200).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    directionsUrl: optionalUrl,
    bookingUrl: optionalUrl,
    waiverUrl: optionalUrl,
    unitLabel: z.string().trim().max(50).optional(),
    unitCapacity: z.number().int().positive().optional(),
    bookingNotes: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  }).strict(),
  admin_manage_trip_activity: z.object({
    action: z.enum(["create", "clone", "clone_from_master", "update", "delete"]),
    tripId: uuid,
    activityId: uuid.optional(),
    masterActivityId: uuid.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().max(100).optional(),
    imageUrl: optionalUrl,
    activityDate: date.optional(),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    locationName: z.string().trim().max(200).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    directionsUrl: optionalUrl,
    bookingUrl: optionalUrl,
    waiverUrl: optionalUrl,
    unitLabel: z.string().trim().max(50).optional(),
    unitCapacity: z.number().int().positive().optional(),
    bookingNotes: z.string().trim().max(2000).nullable().optional(),
    optOutPolicy: z.enum(["locked_on_voucher", "flexible"]).optional(),
    groupCount: z.number().int().nonnegative().optional(),
    autoInitializeGroups: z.boolean().optional(),
    isPairingsLocked: z.boolean().optional(),
  }).strict(),
  record_activity_waiver_click: z.object({
    activityId: uuid,
  }).strict(),
  confirm_activity_waiver_signed: z.object({
    activityId: uuid,
  }).strict(),
  set_activity_participation: z.object({
    tripId: uuid.optional(),
    activityId: uuid,
    status: z.enum(["attending", "opted_out"]),
    notes: z.string().trim().max(500).nullable().optional(),
    memberId: uuid.optional(),
  }).strict(),
  admin_manage_activity_pairings: z.object({
    tripId: uuid.optional(),
    activityId: uuid,
    pairingsAction: z.enum([
      "create_group",
      "delete_group",
      "assign_members",
      "set_group_members",
      "assign",
      "unassign",
      "auto_assign",
      "auto_shuffle",
      "lock_pairings",
      "unlock_pairings",
      "set_pairings",
    ]).optional(),
    action: z.enum([
      "create_group",
      "delete_group",
      "assign_members",
      "set_group_members",
      "assign",
      "unassign",
      "auto_assign",
      "auto_shuffle",
      "lock_pairings",
      "unlock_pairings",
      "set_pairings",
    ]).optional(),
    groupId: uuid.optional(),
    memberId: uuid.optional(),
    groupNumber: z.number().int().positive().optional(),
    groupName: z.string().trim().max(100).optional(),
    groupLabel: z.string().trim().max(100).optional(),
    memberIds: z.array(uuid).optional(),
    lockPairings: z.boolean().optional(),
    groups: z.array(z.object({
      id: uuid.optional(),
      groupId: uuid.optional(),
      group_id: uuid.optional(),
      groupNumber: z.number().int().positive().optional(),
      group_number: z.number().int().positive().optional(),
      groupName: z.string().trim().max(100).optional(),
      group_name: z.string().trim().max(100).optional(),
      memberIds: z.array(uuid).optional(),
      members: z.array(uuid).optional(),
    })).optional(),
    assignments: z.array(z.object({
      groupId: uuid.optional(),
      group_id: uuid.optional(),
      memberId: uuid.optional(),
      member_id: uuid.optional(),
    })).optional(),
  }).strict(),
  submit_activity_voucher: z.object({
    tripId: uuid.optional(),
    groupId: uuid,
    purchaseDate: date.optional(),
    orderNumber: z.string().trim().max(100).nullable().optional(),
    orderReferenceNumber: z.string().trim().max(100).nullable().optional(),
    voucherCode: z.string().trim().max(100).nullable().optional(),
    securityPin: z.string().trim().max(50).nullable().optional(),
    voucherCostCents: z.number().int().nonnegative().optional(),
    amountCents: z.number().int().nonnegative().optional(),
    purchasedByMemberId: uuid.optional(),
    purchaserMemberId: uuid.optional(),
  }).strict(),
  request_partner_swap: z.object({
    tripId: uuid.optional(),
    activityId: uuid,
    targetMemberId: uuid.optional(),
    targetGroupId: uuid.optional(),
  }).strict(),
  respond_partner_swap: z.object({
    swapRequestId: uuid.optional(),
    requestId: uuid.optional(),
    status: z.enum(["accepted", "declined", "cancelled", "accept", "decline", "cancel"]),
  }).strict(),
};

type Member = { member_id: string; auth_user_id: string; member_role: "member" | "admin" | "accountant"; account_status: "active" | "inactive" | "suspended" };
type IdempotencyClaim = { state: "started" | "in_progress" | "replay"; resultId?: string; resultCode?: string };
type Action = typeof actionNames[number];

const adminActions = new Set<Action>([
  "admin_configure_club", "admin_generate_calendar", "admin_reorder_campsites", "admin_update_campsite", "admin_create_campsite",
  "admin_configure_trip", "admin_set_poll_status", "admin_publish_rule", "admin_set_rule_override", "admin_record_interest",
  "admin_promote_from_waitlist", "admin_list_master_responsibilities", "admin_create_master_responsibility", "admin_update_master_responsibility",
  "admin_save_daily_responsibilities", "admin_generate_candidate_slots", "admin_configure_time_slot", "admin_create_custom_time_slot", "admin_add_slot_duty", "admin_update_slot_duty",
  "admin_assign_duty", "admin_reassign_duty", "admin_set_driver_credit", "admin_delete_trip", "admin_create_custom_trip",
  "admin_delete_campsite", "admin_set_daily_workload_target",
  "admin_transition_trip_lifecycle", "admin_update_cabin_reservation",
  "admin_manage_carpool", "admin_override_duty",
  "admin_finalize_settlement",
  "admin_manage_master_gear", "admin_manage_master_food", "admin_delete_master_responsibility",
  "admin_sync_trip_commitments",
  "admin_manage_master_activity", "admin_manage_trip_activity", "admin_manage_activity_pairings",
]);
const mutatingActions = new Set<Action>([
  "admin_configure_club", "admin_generate_calendar", "admin_reorder_campsites", "admin_update_campsite", "admin_create_campsite",
  "admin_configure_trip", "admin_set_poll_status", "admin_publish_rule", "admin_set_rule_override",
  "submit_rsvp", "admin_record_interest", "request_withdrawal", "admin_promote_from_waitlist",
  "admin_create_master_responsibility", "admin_update_master_responsibility",
  "admin_save_daily_responsibilities", "admin_generate_candidate_slots", "admin_configure_time_slot", "admin_create_custom_time_slot", "admin_add_slot_duty", "admin_update_slot_duty",
  "claim_duty", "drop_duty", "admin_assign_duty", "admin_reassign_duty", "admin_set_driver_credit",
  "admin_delete_trip", "admin_create_custom_trip", "admin_delete_campsite", "admin_set_daily_workload_target",
  "admin_transition_trip_lifecycle", "admin_update_cabin_reservation",
  "manage_trip_commitment", "manage_trip_commitments", "admin_manage_carpool", "record_carpool_mileage", "admin_override_duty",
  "admin_manage_trip_expense", "admin_finalize_settlement", "update_settlement_transfer",
  "admin_manage_master_gear", "admin_manage_master_food", "admin_delete_master_responsibility",
  "submit_deposit", "verify_deposit", "admin_sync_trip_commitments",
  "admin_manage_master_activity", "admin_manage_trip_activity", "set_activity_participation",
  "admin_manage_activity_pairings", "submit_activity_voucher", "request_partner_swap", "respond_partner_swap",
  "record_activity_waiver_click", "confirm_activity_waiver_signed",
]);

function errorResponse(request: Request, status: number, code: string, requestId: string, message?: string): Response {
  return json(request, status, { error: code, message: message || code, requestId });
}

function databaseStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "40001" || code === "23505") return 409;
  if (code === "22023" || code === "22P02" || code === "23514" || code === "P0001") return 400;
  if (code === "P0002") return 404;
  return 500;
}

function aggregateId(action: Action, input: Record<string, unknown>, memberId: string): string {
  for (const key of ["tripId", "campsiteId", "activityId", "groupId", "swapRequestId", "memberId", "slotId", "timeSlotId", "slotDutyId", "assignmentId", "commitmentId", "carpoolId", "dutyId", "expenseId", "transferId", "id"]) if (typeof input[key] === "string") return input[key] as string;
  return memberId;
}

async function claim(principal: string, action: Action, aggregate: string, key: string, input: unknown): Promise<IdempotencyClaim> {
  const { data, error } = await service.rpc("phase1_begin_idempotency", {
    p_principal: principal, p_operation: action, p_aggregate: aggregate,
    p_key_hmac: await keyedDigest("IDEMPOTENCY_HMAC_KEY", key),
    p_hmac_key_version: requiredEnv("IDEMPOTENCY_HMAC_KEY_VERSION"),
    p_request_hash: await requestDigest(canonicalJson({ action, input })),
  });
  if (error) throw new Error("idempotency unavailable");
  return data as IdempotencyClaim;
}

async function finish(principal: string, action: Action, aggregate: string, key: string, input: unknown, resultId: string | null): Promise<void> {
  const { error } = await service.rpc("phase1_finish_idempotency", {
    p_principal: principal, p_operation: action, p_aggregate: aggregate,
    p_key_hmac: await keyedDigest("IDEMPOTENCY_HMAC_KEY", key),
    p_hmac_key_version: requiredEnv("IDEMPOTENCY_HMAC_KEY_VERSION"),
    p_request_hash: await requestDigest(canonicalJson({ action, input })),
    p_result_id: resultId, p_result_code: `${action}_completed`,
  });
  if (error) throw new Error("idempotency completion failed");
}

function resultId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  for (const key of ["rsvpId", "tripId", "ruleVersionId", "overrideId", "campsiteId", "invitationId", "activity_id", "activityId", "group_id", "groupId", "request_id", "requestId", "id"]) {
    if (typeof result[key] === "string") return result[key] as string;
  }
  return null;
}

function checkError(error: { code?: string } | null): void {
  if (error) throw Object.assign(new Error("database operation failed"), { code: error.code });
}

async function getCalendar(member: Member): Promise<Record<string, unknown>> {
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const [configuration, campsiteResult, tripResult] = await Promise.all([
    service.from("club_configuration").select("club_timezone,default_poll_lead_days,default_poll_close_time,default_minimum_participants,next_month_to_generate,next_rotation_position,version").eq("singleton", true).single(),
    service.from("campsites").select("id,rotation_position,name,availability_url,location_description,directions,cabin_capacity,cabin_types,reservation_instructions,estimated_rate_cents,availability_status,availability_source_url,availability_verified_at,image_url,camp_host_name,camp_host_phone,camp_features,cabin_information,site_availability,peak_season_timeframe,peak_season_booking_requirement,active,version").eq("active", true).order("rotation_position"),
    service.from("camping_trips").select("id,month_key,rotation_position,suggested_campsite_id,selected_campsite_id,starts_on,ends_on,club_timezone_snapshot,poll_deadline_at,minimum_participants,minimum_basis,max_capacity,per_cabin_capacity,cabin_count,cabin_payer_member_id,poll_status,additional_information,cabin_booking_status,cabin_availability_status,title,event_status,camping_type,task_quota_target,daily_workload_target,deleted_at,version").is("deleted_at", null).gte("month_key", month).order("month_key"),
  ]);
  checkError(configuration.error); checkError(campsiteResult.error); checkError(tripResult.error);
  const trips = tripResult.data ?? [];
  const tripIds = trips.map((trip) => trip.id);
  const openTripIds = trips.filter((trip) => trip.poll_status !== "draft" && trip.event_status !== "cancelled").map((trip) => trip.id);
  if (openTripIds.length) {
    const { error } = await service.rpc("phase2_refresh_open_rule_bundles", { p_actor_id: member.member_id, p_trip_ids: openTripIds });
    checkError(error);
  }
  const [bundleResult, rsvpResult, dutyAssignmentsResult] = tripIds.length ? await Promise.all([
    service.from("trip_rule_bundles").select("id,trip_id,version_no,content_hash,rendered_bundle,created_at").in("trip_id", tripIds).eq("is_current", true),
    service.from("trip_rsvps").select("trip_id,member_id,response,rule_acknowledgment_id,deposit_status,version,updated_at").in("trip_id", tripIds),
    service.from("trip_duty_assignments").select("trip_id,duty:trip_slot_duties!inner(is_active,slot:trip_time_slots!inner(is_enabled))").eq("duty.is_active", true).eq("duty.slot.is_enabled", true).in("trip_id", tripIds).eq("member_id", member.member_id).in("status", ["claimed", "assigned_by_admin"]),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  checkError(bundleResult.error); checkError(rsvpResult.error); checkError(dutyAssignmentsResult.error);

  const dutyCountsByTrip = new Map<string, number>();
  for (const row of dutyAssignmentsResult.data ?? []) {
    dutyCountsByTrip.set(row.trip_id, (dutyCountsByTrip.get(row.trip_id) ?? 0) + 1);
  }
  const [waitlistCountResult, ownWaitlistResult] = tripIds.length ? await Promise.all([
    service
      .from("trip_waitlist_entries")
      .select("trip_id, id", { count: "exact" })
      .in("trip_id", tripIds)
      .eq("status", "waiting"),
    service
      .from("trip_waitlist_entries")
      .select("trip_id, position, status")
      .in("trip_id", tripIds)
      .eq("member_id", member.member_id)
      .eq("status", "waiting"),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  checkError(waitlistCountResult.error);
  checkError(ownWaitlistResult.error);

  const waitlistCountsByTrip = new Map<string, number>();
  for (const row of waitlistCountResult.data ?? []) {
    waitlistCountsByTrip.set(row.trip_id, (waitlistCountsByTrip.get(row.trip_id) ?? 0) + 1);
  }
  const ownWaitlistByTrip = new Map(
    (ownWaitlistResult.data ?? []).map((row) => [row.trip_id, row])
  );
  const rsvps = rsvpResult.data ?? [];
  const acknowledgmentIds = [...new Set(rsvps.map((row) => row.rule_acknowledgment_id).filter((id): id is string => Boolean(id)))];
  const acknowledgmentResult = acknowledgmentIds.length
    ? await service.from("trip_rule_acknowledgments").select("id,bundle_id,content_hash").in("id", acknowledgmentIds)
    : { data: [], error: null };
  checkError(acknowledgmentResult.error);
  const acceptedBundleIds = [...new Set((acknowledgmentResult.data ?? []).map((row) => row.bundle_id))];
  const acceptedBundlesResult = acceptedBundleIds.length
    ? await service.from("trip_rule_bundles").select("id,version_no,content_hash,rendered_bundle,created_at").in("id", acceptedBundleIds)
    : { data: [], error: null };
  checkError(acceptedBundlesResult.error);
  const acknowledgmentById = new Map((acknowledgmentResult.data ?? []).map((row) => [row.id, row]));
  const acceptedBundlesById = new Map((acceptedBundlesResult.data ?? []).map((bundle) => [bundle.id, bundle]));
  const memberIds = [...new Set(rsvps.map((row) => row.member_id))];
  const memberProfiles = memberIds.length
    ? await service.from("member_profiles").select("member_id,display_name").in("member_id", memberIds).eq("account_status", "active").eq("account_status", "active")
    : { data: [], error: null };
  checkError(memberProfiles.error);
  const memberRows = memberProfiles.data ?? [];
  const activeMemberNames = new Map(memberRows.map((row) => [row.member_id, row.display_name]));
  const activeMemberIds = new Set(activeMemberNames.keys());
  const activeRsvps = rsvps.filter((row) => activeMemberIds.has(row.member_id));
  const bundlesByTrip = new Map((bundleResult.data ?? []).map((bundle) => [bundle.trip_id, bundle]));
  const ownRsvps = new Map(activeRsvps.filter((row) => row.member_id === member.member_id).map((row) => [row.trip_id, row]));
  const counts = new Map<string, number>();
  for (const row of activeRsvps) if (row.response === "coming") counts.set(row.trip_id, (counts.get(row.trip_id) ?? 0) + 1);

  let campsites = campsiteResult.data ?? [];
  let activeMembers: Array<{ memberId: string; displayName: string }> = [];
  let withdrawalRequests: Array<{ requestId: string; tripId: string; memberId: string; displayName: string; reason: string; createdAt: string }> = [];
  if (member.member_role === "admin") {
    const { data: notes, error } = await service.rpc("phase2_admin_get_campsite_notes", { p_actor_id: member.member_id });
    checkError(error);
    const notesBySite = new Map((notes ?? []).map((row) => [row.campsite_id, row.admin_notes]));
    campsites = campsites.map((site) => ({ ...site, admin_notes: notesBySite.get(site.id) ?? "" }));
    const { data: allMembers, error: membersError } = await service.from("member_profiles").select("member_id,display_name").eq("account_status", "active").order("display_name");
    checkError(membersError);
    activeMembers = (allMembers ?? []).map((row) => ({ memberId: row.member_id, displayName: row.display_name }));
    const { data: requests, error: requestsError } = await service.from("trip_withdrawal_requests").select("id,trip_id,member_id,reason,created_at").in("trip_id", tripIds).order("created_at", { ascending: false });
    checkError(requestsError);
    withdrawalRequests = (requests ?? []).map((row) => ({ requestId: row.id, tripId: row.trip_id, memberId: row.member_id, displayName: activeMemberNames.get(row.member_id) ?? "Member", reason: row.reason, createdAt: row.created_at }));
  }

  const dailyByTrip = new Map<string, unknown>();
  await Promise.all(trips.filter(trip => trip.daily_workload_target != null).map(async trip => {
    const progress = await service.rpc("phase3_get_daily_workload_progress", { p_trip_id: trip.id, p_member_id: member.member_id });
    checkError(progress.error);
    dailyByTrip.set(trip.id, progress.data);
  }));
  return {
    clubConfiguration: {
      timezone: configuration.data.club_timezone,
      defaultPollLeadDays: configuration.data.default_poll_lead_days,
      defaultPollCloseTime: configuration.data.default_poll_close_time,
      defaultMinimumParticipants: configuration.data.default_minimum_participants,
      nextMonthToGenerate: configuration.data.next_month_to_generate,
      nextRotationPosition: configuration.data.next_rotation_position,
      version: configuration.data.version,
    },
    campsites: campsites.map((site) => ({
      campsiteId: site.id, rotationPosition: site.rotation_position, name: site.name, availabilityUrl: site.availability_url,
      locationDescription: site.location_description, directions: site.directions, cabinCapacity: site.cabin_capacity,
      cabinTypes: site.cabin_types, reservationInstructions: site.reservation_instructions,
      estimatedRateCents: site.estimated_rate_cents, availabilityStatus: site.availability_status,
      availabilitySourceUrl: site.availability_source_url, availabilityVerifiedAt: site.availability_verified_at,
      imageUrl: site.image_url,
      campHostName: site.camp_host_name,
      campHostPhone: site.camp_host_phone,
      campFeatures: site.camp_features ?? [],
      cabinInformation: site.cabin_information,
      siteAvailability: site.site_availability ?? "open_year_round",
      peakSeasonTimeframe: site.peak_season_timeframe,
      peakSeasonBookingRequirement: site.peak_season_booking_requirement,
      adminNotes: member.member_role === "admin" ? (site as typeof site & { admin_notes?: string }).admin_notes : undefined,
      version: site.version,
    })),
    members: member.member_role === "admin" ? activeMembers : undefined,
    withdrawalRequests: member.member_role === "admin" ? withdrawalRequests : undefined,
    trips: trips.map((trip) => {
      const bundle = bundlesByTrip.get(trip.id);
      const own = ownRsvps.get(trip.id);
      const acceptedAck = own?.rule_acknowledgment_id ? acknowledgmentById.get(own.rule_acknowledgment_id) : undefined;
      const acceptedBundle = acceptedAck ? acceptedBundlesById.get(acceptedAck.bundle_id) : undefined;
      const participantEntries = member.member_role === "admin"
        ? activeRsvps.filter((row) => row.trip_id === trip.id).map((row) => ({ memberId: row.member_id, displayName: activeMemberNames.get(row.member_id) ?? "Member", response: row.response, version: row.version, acknowledgmentId: row.rule_acknowledgment_id }))
        : undefined;
      return {
        tripId: trip.id, monthKey: String(trip.month_key).slice(0, 7), rotationPosition: trip.rotation_position,
        suggestedCampsiteId: trip.suggested_campsite_id, selectedCampsiteId: trip.selected_campsite_id,
        startsOn: trip.starts_on, endsOn: trip.ends_on, clubTimezone: trip.club_timezone_snapshot,
        pollDeadlineAt: trip.poll_deadline_at, minimumParticipants: trip.minimum_participants,
        minimumBasis: null, maxCapacity: trip.max_capacity,
        perCabinCapacity: trip.per_cabin_capacity ?? 6,
        cabinCount: trip.cabin_count ?? null,
        effectiveCapacity: trip.max_capacity
          ?? (trip.cabin_count != null ? trip.cabin_count * (trip.per_cabin_capacity ?? 6) : null),
        spotsRemaining: trip.max_capacity != null
          ? Math.max(0, trip.max_capacity - (counts.get(trip.id) ?? 0))
          : trip.cabin_count != null
            ? Math.max(0, trip.cabin_count * (trip.per_cabin_capacity ?? 6) - (counts.get(trip.id) ?? 0))
            : null,
        waitlistCount: waitlistCountsByTrip.get(trip.id) ?? 0,
        myWaitlistPosition: ownWaitlistByTrip.get(trip.id)?.position ?? null,
        myWaitlistEntry: ownWaitlistByTrip.get(trip.id)
          ? { position: ownWaitlistByTrip.get(trip.id)!.position, status: ownWaitlistByTrip.get(trip.id)!.status }
          : undefined,
        pollStatus: trip.poll_status,
        title: trip.title ?? null,
        eventStatus: trip.event_status ?? "tentative",
        campingType: trip.camping_type ?? "cabin",
        taskQuotaTarget: (trip as any).task_quota_target ?? 2,
        myDutyCount: dutyCountsByTrip.get(trip.id) ?? 0,
        myDailyWorkload: dailyByTrip.get(trip.id) ?? null,
        additionalInformation: trip.additional_information, cabinBookingStatus: trip.cabin_booking_status,
        legacyCabinAvailabilityStatus: member.member_role === "admin" ? trip.cabin_availability_status : undefined,
        cabinPayerMemberId: (trip as any).cabin_payer_member_id ?? null,
        depositStatus: (trip as any).cabin_payer_member_id === member.member_id ? "exempt" : ((own as any)?.deposit_status ?? "unpaid"),
        version: trip.version, comingCount: counts.get(trip.id) ?? 0, tripDecision: "none",
        currentRuleBundle: bundle ? { id: bundle.id, version: bundle.version_no, contentHash: bundle.content_hash, rules: bundle.rendered_bundle, createdAt: bundle.created_at } : null,
        myRsvp: own ? {
          response: own.response, acknowledgmentId: own.rule_acknowledgment_id, version: own.version, updatedAt: own.updated_at,
          acceptedRuleBundle: acceptedBundle ? { id: acceptedBundle.id, version: acceptedBundle.version_no, contentHash: acceptedBundle.content_hash, rules: acceptedBundle.rendered_bundle, createdAt: acceptedBundle.created_at } : null,
        } : null,
        participantEntries,
      };
    }),
  };
}

interface MealPreferenceRecord {
  id: string;
  trip_id: string;
  member_id: string;
  saturday_beverage: "coffee" | "tea" | "none";
  sunday_beverage: "coffee" | "tea" | "none";
  default_diet: "vegetarian" | "non_vegetarian";
  meal_choices: Record<string, "veg" | "non_veg" | "skip">;
  allergies_notes?: string | null;
  alcohol_beverages?: string[] | null;
  created_at?: string;
  updated_at?: string;
}

function formatMealPreferences(row: MealPreferenceRecord | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    tripId: row.trip_id,
    memberId: row.member_id,
    saturdayBeverage: row.saturday_beverage,
    sundayBeverage: row.sunday_beverage,
    defaultDiet: row.default_diet,
    mealChoices: row.meal_choices ?? {},
    allergiesNotes: row.allergies_notes ?? null,
    alcoholBeverages: Array.isArray(row.alcohol_beverages) ? row.alcohol_beverages : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeMealHeadcounts(
  comingMemberIds: string[],
  preferences: MealPreferenceRecord[],
  mealSlots: Array<{ id: string; label: string; slot_date: string }>
) {
  const prefMap = new Map<string, MealPreferenceRecord>();
  for (const pref of preferences) {
    prefMap.set(pref.member_id, pref);
  }

  const beverages = {
    saturday: { coffee: 0, tea: 0, none: 0 },
    sunday: { coffee: 0, tea: 0, none: 0 },
  };

  const alcohol = {
    beer: 0,
    wine: 0,
    liquor: 0,
    byob: 0,
    none: 0,
  };

  for (const memberId of comingMemberIds) {
    const pref = prefMap.get(memberId);
    const sat = pref ? pref.saturday_beverage : "coffee";
    const sun = pref ? pref.sunday_beverage : "tea";

    if (sat === "coffee") beverages.saturday.coffee++;
    else if (sat === "tea") beverages.saturday.tea++;
    else if (sat === "none") beverages.saturday.none++;

    if (sun === "coffee") beverages.sunday.coffee++;
    else if (sun === "tea") beverages.sunday.tea++;
    else if (sun === "none") beverages.sunday.none++;

    const alcs = Array.isArray(pref?.alcohol_beverages) ? pref!.alcohol_beverages : [];
    if (alcs.length === 0 || alcs.includes("none")) {
      alcohol.none++;
    } else {
      if (alcs.includes("beer")) alcohol.beer++;
      if (alcs.includes("wine")) alcohol.wine++;
      if (alcs.includes("liquor")) alcohol.liquor++;
      if (alcs.includes("byob")) alcohol.byob++;
    }
  }

  const meals = mealSlots.map((slot) => {
    let vegCount = 0;
    let nonVegCount = 0;
    let skipCount = 0;

    for (const memberId of comingMemberIds) {
      const pref = prefMap.get(memberId);
      const choice = pref?.meal_choices?.[slot.id];
      if (choice === "veg") {
        vegCount++;
      } else if (choice === "non_veg") {
        nonVegCount++;
      } else if (choice === "skip") {
        skipCount++;
      } else {
        const defaultDiet = pref?.default_diet ?? "vegetarian";
        if (defaultDiet === "non_vegetarian") {
          nonVegCount++;
        } else {
          vegCount++;
        }
      }
    }

    return {
      slotId: slot.id,
      slotLabel: slot.label,
      slotDate: slot.slot_date,
      vegCount,
      nonVegCount,
      skipCount,
      totalEating: vegCount + nonVegCount,
    };
  });

  return { beverages, meals, alcohol };
}

async function getTripDetails(member: Member, tripId: string): Promise<Record<string, unknown>> {
  const tripResult = await service.from("camping_trips")
    .select("id,month_key,rotation_position,suggested_campsite_id,selected_campsite_id,starts_on,ends_on,club_timezone_snapshot,poll_deadline_at,minimum_participants,minimum_basis,max_capacity,per_cabin_capacity,cabin_count,poll_status,additional_information,cabin_booking_status,title,event_status,trip_status,camping_type,task_quota_target,daily_workload_target,trip_mileage_rate_cents,deposit_amount_cents,cabin_payer_member_id,rules_markdown,deleted_at,version")
    .eq("id", tripId)
    .is("deleted_at", null)
    .maybeSingle();
  if (tripResult.error && tripResult.error.code !== "PGRST116") {
    checkError(tripResult.error);
  }
  if (!tripResult.data) {
    throw Object.assign(new Error("trip not found"), { code: "22023", status: 404 });
  }
  const trip = tripResult.data;

  if (trip.poll_status !== "draft" && trip.event_status !== "cancelled") {
    const { error: refreshError } = await service.rpc("phase2_refresh_open_rule_bundles", {
      p_actor_id: member.member_id,
      p_trip_ids: [tripId],
    });
    checkError(refreshError);
  }

  const [
    campsiteResult,
    bundleResult,
    rsvpResult,
    waitlistResult,
    dutiesResult,
    cabinReservationResult,
    commitmentsResult,
    mealPrefsResult,
    mealSlotsResult,
  ] = await Promise.all([
    trip.selected_campsite_id
      ? service.from("campsites")
          .select("id,rotation_position,name,availability_url,location_description,directions,cabin_capacity,cabin_types,reservation_instructions,estimated_rate_cents,availability_status,availability_source_url,availability_verified_at,image_url,camp_host_name,camp_host_phone,camp_features,cabin_information,site_availability,peak_season_timeframe,peak_season_booking_requirement,version")
          .eq("id", trip.selected_campsite_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    service.from("trip_rule_bundles")
      .select("id,trip_id,version_no,content_hash,rendered_bundle,created_at")
      .eq("trip_id", tripId)
      .eq("is_current", true)
      .maybeSingle(),
    service.from("trip_rsvps")
      .select("trip_id,member_id,response,rule_acknowledgment_id,deposit_status,deposit_submitted_at,deposit_confirmed_at,deposit_confirmed_by,version,updated_at")
      .eq("trip_id", tripId),
    service.from("trip_waitlist_entries")
      .select("id,member_id,position,status,created_at")
      .eq("trip_id", tripId)
      .eq("status", "waiting")
      .order("position"),
    service.from("trip_duty_assignments")
      .select("id,duty:trip_slot_duties!inner(is_active,slot:trip_time_slots!inner(is_enabled))", { count: "exact", head: true })
      .eq("duty.is_active", true).eq("duty.slot.is_enabled", true)
      .eq("trip_id", tripId)
      .eq("member_id", member.member_id)
      .in("status", ["claimed", "assigned_by_admin"]),
    service.from("cabin_reservations")
      .select("id,status,reservation_reference,provider_label,paid_by_member_id,reservation_amount_cents,cabin_count,per_cabin_capacity,cancellation_notes,updated_at")
      .eq("trip_id", tripId)
      .maybeSingle(),
    service.from("trip_commitments")
      .select("id,trip_id,category,item_name,quantity_description,assigned_member_id,is_critical,master_gear_id,master_food_id,commitment_type,is_active,created_at,updated_at")
      .eq("trip_id", tripId)
      .order("created_at"),
    service.from("trip_meal_preferences")
      .select("id,trip_id,member_id,saturday_beverage,sunday_beverage,default_diet,meal_choices,allergies_notes,alcohol_beverages,created_at,updated_at")
      .eq("trip_id", tripId),
    service.from("trip_time_slots")
      .select("id,trip_id,slot_date,time_block,slot_type,label,is_enabled,sort_order,created_at")
      .eq("trip_id", tripId)
      .eq("slot_type", "meal")
      .neq("is_enabled", false)
      .order("slot_date", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  checkError(campsiteResult.error);
  checkError(bundleResult.error);
  checkError(rsvpResult.error);
  checkError(waitlistResult.error);
  checkError(dutiesResult.error);
  checkError(commitmentsResult.error);
  checkError(mealPrefsResult.error);
  checkError(mealSlotsResult.error);

  const campsite = campsiteResult.data;
  const rsvps = rsvpResult.data ?? [];
  const waitlist = waitlistResult.data ?? [];
  let rawCommitments = commitmentsResult.data ?? [];
  if (rawCommitments.length === 0) {
    try {
      let seedActorId = member.member_role === "admin" ? member.member_id : null;
      if (!seedActorId) {
        const { data: adminRow } = await service
          .from("member_profiles")
          .select("member_id")
          .eq("member_role", "admin")
          .eq("account_status", "active")
          .limit(1)
          .maybeSingle();
        seedActorId = adminRow?.member_id ?? null;
      }
      if (seedActorId) {
        const { data: seedRes } = await service.rpc("seed_trip_commitments_from_master", {
          p_trip_id: tripId,
          p_actor_id: seedActorId,
        });
        if (seedRes && ((seedRes as any).gear_seeded > 0 || (seedRes as any).food_seeded > 0)) {
          const { data: refreshed } = await service
            .from("trip_commitments")
            .select("id,trip_id,category,item_name,quantity_description,assigned_member_id,is_critical,master_gear_id,master_food_id,commitment_type,is_active,created_at,updated_at")
            .eq("trip_id", tripId)
            .order("created_at");
          if (refreshed && refreshed.length > 0) {
            rawCommitments = refreshed;
          }
        }
      }
    } catch (seedErr) {
      console.warn("Auto-seed commitments in getTripDetails warning:", seedErr);
    }
  }
  const commitmentMemberIds = rawCommitments.map((c: any) => c.assigned_member_id).filter(Boolean);
  const memberIds = [...new Set([...rsvps.map((r) => r.member_id), ...waitlist.map((w) => w.member_id), ...commitmentMemberIds])];
  const { data: memberRows, error: memberRowsError } = memberIds.length
    ? await service.from("member_profiles").select("member_id,display_name").in("member_id", memberIds).eq("account_status", "active")
    : { data: [], error: null };
  checkError(memberRowsError);
  const nameMap = new Map((memberRows ?? []).map((m) => [m.member_id, m.display_name]));

  const ownRsvp = rsvps.find((r) => r.member_id === member.member_id);
  const comingCount = rsvps.filter((r) => r.response === "coming").length;

  const comingMemberIds = rsvps.filter((r) => r.response === "coming").map((r) => r.member_id);
  const allPrefs = (mealPrefsResult.data ?? []) as MealPreferenceRecord[];
  const ownPreference = allPrefs.find((p) => p.member_id === member.member_id);
  const mealHeadcounts = computeMealHeadcounts(comingMemberIds, allPrefs, (mealSlotsResult.data ?? []) as any[]);

  const participantEntries = rsvps
    .filter((r) => r.response === "coming")
    .map((r) => ({
      memberId: r.member_id,
      displayName: nameMap.get(r.member_id) ?? "Member",
      response: r.response,
      depositStatus: r.member_id === trip.cabin_payer_member_id ? "exempt" : (r.deposit_status ?? "unpaid"),
    }));

  const commitmentsList = rawCommitments.map((c: any) => ({
    id: c.id,
    tripId: c.trip_id,
    category: c.category,
    itemName: c.item_name,
    quantityDescription: c.quantity_description,
    assignedMemberId: c.assigned_member_id,
    assignedMemberName: c.assigned_member_id ? (nameMap.get(c.assigned_member_id) ?? "Member") : null,
    isCritical: c.is_critical,
    masterGearId: c.master_gear_id ?? null,
    masterFoodId: c.master_food_id ?? null,
    commitmentType: c.commitment_type ?? "shared_volunteer",
    isActive: c.is_active ?? true,
    isMine: c.assigned_member_id === member.member_id,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  const individualPack = commitmentsList.filter((c: any) => c.commitmentType === "individual_pack" && c.isActive);
  const sharedVolunteer = commitmentsList.filter((c: any) => c.commitmentType === "shared_volunteer" && c.isActive);

  const waitlistEntries = member.member_role === "admin"
    ? waitlist.map((w) => ({
        memberId: w.member_id,
        displayName: nameMap.get(w.member_id) ?? "Member",
        position: w.position,
        createdAt: w.created_at,
      }))
    : [];

  let allMemberEntries: Array<{ memberId: string; displayName: string; response: string; version: number }> = [];
  if (member.member_role === "admin") {
    const { data: allActiveMembers, error: allMembersError } = await service
      .from("member_profiles")
      .select("member_id,display_name")
      .eq("account_status", "active")
      .order("display_name");
    checkError(allMembersError);

    const rsvpByMember = new Map(rsvps.map((r) => [r.member_id, r]));
    allMemberEntries = (allActiveMembers ?? []).map((m) => {
      const r = rsvpByMember.get(m.member_id);
      return {
        memberId: m.member_id,
        displayName: m.display_name,
        response: r?.response ?? "not_coming",
        version: r?.version ?? 0,
      };
    });
  }

  const ownWaitlistEntry = waitlist.find((w) => w.member_id === member.member_id);

  let acceptedRuleBundle: Record<string, unknown> | null = null;
  if (ownRsvp?.rule_acknowledgment_id) {
    const { data: ack, error: ackErr } = await service.from("trip_rule_acknowledgments")
      .select("id,bundle_id,content_hash")
      .eq("id", ownRsvp.rule_acknowledgment_id)
      .maybeSingle();
    checkError(ackErr);
    if (ack?.bundle_id) {
      const { data: b, error: bErr } = await service.from("trip_rule_bundles")
        .select("id,version_no,content_hash,rendered_bundle,created_at")
        .eq("id", ack.bundle_id)
        .maybeSingle();
      checkError(bErr);
      if (b) {
        acceptedRuleBundle = {
          id: b.id,
          version: b.version_no,
          contentHash: b.content_hash,
          rules: b.rendered_bundle,
          createdAt: b.created_at,
        };
      }
    }
  }

  const dailyProgress = trip.daily_workload_target == null ? { data: null, error: null }
    : await service.rpc("phase3_get_daily_workload_progress", { p_trip_id: trip.id, p_member_id: member.member_id });
  checkError(dailyProgress.error);
  const effectiveCapacity = trip.max_capacity
    ?? (trip.cabin_count != null ? trip.cabin_count * (trip.per_cabin_capacity ?? 6) : null);

  return {
    tripId: trip.id,
    monthKey: String(trip.month_key).slice(0, 7),
    title: trip.title ?? null,
    eventStatus: trip.event_status ?? "tentative",
    tripStatus: trip.trip_status ?? trip.event_status ?? "rsvp_open",
    campingType: trip.camping_type ?? "cabin",
    taskQuotaTarget: (trip as any).task_quota_target ?? 2,
    myDutyCount: dutiesResult.count ?? 0,
    myDailyWorkload: dailyProgress.data,
    pollStatus: trip.poll_status,
    startsOn: trip.starts_on,
    endsOn: trip.ends_on,
    clubTimezone: trip.club_timezone_snapshot,
    pollDeadlineAt: trip.poll_deadline_at,
    minimumParticipants: trip.minimum_participants,
    maxCapacity: trip.max_capacity,
    perCabinCapacity: trip.per_cabin_capacity ?? 6,
    cabinCount: trip.cabin_count ?? null,
    effectiveCapacity,
    spotsRemaining: effectiveCapacity != null ? Math.max(0, effectiveCapacity - comingCount) : null,
    comingCount,
    waitlistCount: waitlist.length,
    myWaitlistPosition: ownWaitlistEntry?.position ?? null,
    myWaitlistEntry: ownWaitlistEntry
      ? { position: ownWaitlistEntry.position, status: ownWaitlistEntry.status }
      : undefined,
    cabinBookingStatus: trip.cabin_booking_status,
    selectedCampsiteId: trip.selected_campsite_id,
    additionalInformation: trip.additional_information,
    tripMileageRateCents: trip.trip_mileage_rate_cents ?? 50,
    depositAmountCents: trip.deposit_amount_cents ?? 5000,
    cabinPayerMemberId: trip.cabin_payer_member_id ?? null,
    depositStatus: trip.cabin_payer_member_id === member.member_id ? "exempt" : (ownRsvp?.deposit_status ?? "unpaid"),
    rulesMarkdown: trip.rules_markdown ?? null,
    commitmentsList,
    commitments: {
      individualPack,
      sharedVolunteer,
    },
    cabinReservation: cabinReservationResult?.data ?? null,
    version: trip.version,
    campsite: campsite ? {
      campsiteId: campsite.id,
      name: campsite.name,
      locationDescription: campsite.location_description,
      availabilityUrl: campsite.availability_url,
      directions: campsite.directions,
      cabinCapacity: campsite.cabin_capacity,
      cabinTypes: campsite.cabin_types,
      reservationInstructions: campsite.reservation_instructions,
      estimatedRateCents: campsite.estimated_rate_cents,
      availabilityStatus: campsite.availability_status,
      availabilitySourceUrl: campsite.availability_source_url,
      adminNotes: campsite.admin_notes ?? "",
      imageUrl: campsite.image_url,
      campHostName: campsite.camp_host_name,
      campHostPhone: campsite.camp_host_phone,
      campFeatures: campsite.camp_features ?? [],
      cabinInformation: campsite.cabin_information,
      siteAvailability: campsite.site_availability ?? "open_year_round",
      peakSeasonTimeframe: campsite.peak_season_timeframe,
      peakSeasonBookingRequirement: campsite.peak_season_booking_requirement,
      version: campsite.version,
    } : null,
    currentRuleBundle: bundleResult.data ? {
      id: bundleResult.data.id,
      version: bundleResult.data.version_no,
      contentHash: bundleResult.data.content_hash,
      rules: (bundleResult.data.rendered_bundle as Array<{ stable_key: string; text: string; structured_values: Record<string, unknown> }>),
      createdAt: bundleResult.data.created_at,
    } : null,
    myRsvp: ownRsvp ? {
      response: ownRsvp.response,
      depositStatus: trip.cabin_payer_member_id === member.member_id ? "exempt" : (ownRsvp.deposit_status ?? "unpaid"),
      depositSubmittedAt: ownRsvp.deposit_submitted_at ?? null,
      depositConfirmedAt: ownRsvp.deposit_confirmed_at ?? null,
      acknowledgmentId: ownRsvp.rule_acknowledgment_id,
      version: ownRsvp.version,
      updatedAt: ownRsvp.updated_at,
      acceptedRuleBundle,
    } : null,
    participantEntries,
    waitlistEntries,
    allMemberEntries,
    myMealPreferences: formatMealPreferences(ownPreference),
    mealHeadcounts,
  };
}

async function getTripLogistics(member: Member, tripId: string): Promise<Record<string, unknown>> {
  const [tripResult, commitmentsResult, carpoolsResult] = await Promise.all([
    service.from("camping_trips")
      .select("id, task_quota_target, deposit_amount_cents, title, starts_on, ends_on, version")
      .eq("id", tripId)
      .is("deleted_at", null)
      .single(),
    service.from("trip_commitments")
      .select("id, trip_id, category, item_name, quantity_description, assigned_member_id, is_critical, master_gear_id, master_food_id, commitment_type, is_active, created_at, updated_at")
      .eq("trip_id", tripId)
      .order("category")
      .order("item_name"),
    service.from("trip_carpools")
      .select(`
        id, trip_id, driver_member_id, vehicle_description, max_seats,
        starting_mileage, ending_mileage, departure_details, created_at, updated_at,
        riders:trip_carpool_riders(id, carpool_id, rider_member_id)
      `)
      .eq("trip_id", tripId)
      .order("created_at"),
  ]);
  checkError(tripResult.error);
  checkError(commitmentsResult.error);
  checkError(carpoolsResult.error);

  let rawCommitments = commitmentsResult.data ?? [];
  if (rawCommitments.length === 0) {
    try {
      let seedActorId = member.member_role === "admin" ? member.member_id : null;
      if (!seedActorId) {
        const { data: adminRow } = await service
          .from("member_profiles")
          .select("member_id")
          .eq("member_role", "admin")
          .eq("account_status", "active")
          .limit(1)
          .maybeSingle();
        seedActorId = adminRow?.member_id ?? null;
      }
      if (seedActorId) {
        const { data: seedRes } = await service.rpc("seed_trip_commitments_from_master", {
          p_trip_id: tripId,
          p_actor_id: seedActorId,
        });
        if (seedRes && ((seedRes as any).gear_seeded > 0 || (seedRes as any).food_seeded > 0)) {
          const { data: refreshed } = await service
            .from("trip_commitments")
            .select("id, trip_id, category, item_name, quantity_description, assigned_member_id, is_critical, master_gear_id, master_food_id, commitment_type, is_active, created_at, updated_at")
            .eq("trip_id", tripId)
            .order("category")
            .order("item_name");
          if (refreshed && refreshed.length > 0) {
            rawCommitments = refreshed;
          }
        }
      }
    } catch (seedErr) {
      console.warn("Auto-seed commitments in getTripLogistics warning:", seedErr);
    }
  }
  const rawCarpools = carpoolsResult.data ?? [];

  const memberIdSet = new Set<string>();
  for (const c of rawCommitments) {
    if (c.assigned_member_id) memberIdSet.add(c.assigned_member_id);
  }
  for (const cp of rawCarpools) {
    if (cp.driver_member_id) memberIdSet.add(cp.driver_member_id);
    for (const r of ((cp as any).riders ?? [])) {
      if (r.rider_member_id) memberIdSet.add(r.rider_member_id);
    }
  }

  const { data: memberProfiles } = memberIdSet.size > 0
    ? await service.from("member_profiles").select("member_id, display_name").in("member_id", Array.from(memberIdSet))
    : { data: [] };

  const nameMap = new Map((memberProfiles ?? []).map((m: any) => [m.member_id, m.display_name]));

  const commitments = rawCommitments.map((c: any) => ({
    id: c.id,
    tripId: c.trip_id,
    category: c.category,
    itemName: c.item_name,
    quantityDescription: c.quantity_description,
    assignedMemberId: c.assigned_member_id,
    assignedMemberName: c.assigned_member_id ? (nameMap.get(c.assigned_member_id) ?? "Member") : null,
    isCritical: c.is_critical,
    masterGearId: c.master_gear_id ?? null,
    masterFoodId: c.master_food_id ?? null,
    commitmentType: c.commitment_type ?? "shared_volunteer",
    isActive: c.is_active ?? true,
    isMine: c.assigned_member_id === member.member_id,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  const carpools = rawCarpools.map((cp: any) => {
    const riders = ((cp as any).riders ?? []).map((r: { id: string; rider_member_id: string }) => ({
      id: r.id,
      riderMemberId: r.rider_member_id,
      displayName: nameMap.get(r.rider_member_id) ?? "Member",
      isMe: r.rider_member_id === member.member_id,
    }));
    const totalMiles = (cp.ending_mileage != null && cp.starting_mileage != null)
      ? Math.max(0, Number(cp.ending_mileage) - Number(cp.starting_mileage))
      : null;

    return {
      id: cp.id,
      tripId: cp.trip_id,
      driverMemberId: cp.driver_member_id,
      driverName: nameMap.get(cp.driver_member_id) ?? "Driver",
      vehicleDescription: cp.vehicle_description,
      maxSeats: cp.max_seats,
      occupiedSeats: riders.length + 1,
      availableSeats: Math.max(0, cp.max_seats - (riders.length + 1)),
      startingMileage: cp.starting_mileage != null ? Number(cp.starting_mileage) : null,
      endingMileage: cp.ending_mileage != null ? Number(cp.ending_mileage) : null,
      totalMiles,
      departureDetails: cp.departure_details,
      isMyCarpool: cp.driver_member_id === member.member_id,
      riders,
    };
  });

  const myCarpoolDriver = carpools.find((cp: any) => cp.driverMemberId === member.member_id);
  const myCarpoolRider = carpools.find((cp: any) => cp.riders.some((r: any) => r.riderMemberId === member.member_id));

  let carpoolRole: "driver" | "rider" | "unassigned" = "unassigned";
  let carpoolDetails: string | null = null;
  if (myCarpoolDriver) {
    carpoolRole = "driver";
    carpoolDetails = `Driver (${myCarpoolDriver.vehicleDescription})`;
  } else if (myCarpoolRider) {
    carpoolRole = "rider";
    carpoolDetails = `Riding with ${myCarpoolRider.driverName} (${myCarpoolRider.vehicleDescription})`;
  }

  const myCommitments = commitments.filter((c: any) => c.assignedMemberId === member.member_id);
  const criticalMissing = commitments.filter((c: any) => c.isCritical && !c.assignedMemberId);

  return {
    tripId,
    commitments,
    carpools,
    memberReadiness: {
      carpoolRole,
      carpoolDetails,
      myCommitmentsCount: myCommitments.length,
      criticalMissingCount: criticalMissing.length,
      totalCarpoolsCount: carpools.length,
    },
  };
}

async function getTripFinancials(member: Member, tripId: string): Promise<Record<string, unknown>> {
  const [tripResult, expensesResult, rsvpsResult, carpoolsResult, latestRunResult, paymentMethodsResult] = await Promise.all([
    service.from("camping_trips")
      .select("id, starts_on, ends_on, title, trip_status, event_status, trip_mileage_rate_cents, deposit_amount_cents, cabin_payer_member_id")
      .eq("id", tripId)
      .is("deleted_at", null)
      .single(),
    service.from("trip_expenses")
      .select(`
        id, trip_id, expense_type, payer_member_id, amount_cents, description,
        incurred_date, receipt_url, source_reference_id, is_locked, created_at,
        split_mode, receipt_storage_path, receipt_file_name, receipt_content_type,
        allocations:trip_expense_allocations(id, member_id, allocated_cents)
      `)
      .eq("trip_id", tripId)
      .order("created_at"),
    service.from("trip_rsvps")
      .select("member_id, response, deposit_status")
      .eq("trip_id", tripId)
      .eq("response", "coming"),
    service.from("trip_carpools")
      .select(`
        id, trip_id, driver_member_id, vehicle_description, max_seats,
        starting_mileage, ending_mileage, departure_details,
        riders:trip_carpool_riders(id, rider_member_id)
      `)
      .eq("trip_id", tripId),
    service.from("settlement_runs")
      .select(`
        id, trip_id, version_no, status, total_expenses_cents, algorithm_used,
        snapshot_hash, created_by, finalized_at, settled_at, created_at,
        balances:settlement_balances(id, member_id, total_paid_cents, total_allocated_cents, net_balance_cents),
        transfers:settlement_transfers(
          id, payer_member_id, recipient_member_id, amount_cents, status,
          marked_sent_at, confirmed_received_at, payment_method, notes
        )
      `)
      .eq("trip_id", tripId)
      .in("status", ["finalized", "settled"])
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service.from("member_payment_methods")
      .select("id, member_id, method, preferred, accepted_for_receiving")
      .eq("active", true),
  ]);

  checkError(tripResult.error);
  checkError(expensesResult.error);
  checkError(rsvpsResult.error);
  checkError(carpoolsResult.error);

  const trip = tripResult.data;
  const rawExpenses = expensesResult.data ?? [];
  const confirmedAttendees = (rsvpsResult.data ?? []).map((r) => r.member_id);
  const rawCarpools = carpoolsResult.data ?? [];
  const latestRun = latestRunResult?.data ?? null;

  const memberIdSet = new Set<string>(confirmedAttendees);
  if (trip.cabin_payer_member_id) memberIdSet.add(trip.cabin_payer_member_id);
  for (const exp of rawExpenses) {
    memberIdSet.add(exp.payer_member_id);
    for (const a of ((exp as any).allocations ?? [])) {
      memberIdSet.add(a.member_id);
    }
  }
  for (const cp of rawCarpools) {
    memberIdSet.add(cp.driver_member_id);
    for (const r of ((cp as any).riders ?? [])) {
      memberIdSet.add(r.rider_member_id);
    }
  }

  const { data: memberProfiles } = memberIdSet.size > 0
    ? await service.from("member_profiles").select("member_id, display_name").in("member_id", Array.from(memberIdSet))
    : { data: [] };

  const nameMap = new Map((memberProfiles ?? []).map((m: any) => [m.member_id, m.display_name]));

  const paymentMethodsByMember = new Map<string, { method: string; label: string }>();
  for (const pm of (paymentMethodsResult.data ?? [])) {
    if (pm.preferred || !paymentMethodsByMember.has(pm.member_id)) {
      paymentMethodsByMember.set(pm.member_id, {
        method: pm.method,
        label: pm.method.replace("_", " ").toUpperCase(),
      });
    }
  }

  const isFinalized = latestRun != null && (latestRun.status === "finalized" || latestRun.status === "settled");

  const expenses = rawExpenses.map((exp: any) => {
    let expAllocs: Array<{ id?: string; memberId: string; memberName: string; allocatedCents: number; isMe: boolean }>;
    const isDynamic = !isFinalized && exp.expense_type !== "website_maintenance" && (
      exp.split_mode === "all_attendees" ||
      (!exp.is_locked && (exp.allocations ?? []).length >= Math.max(2, confirmedAttendees.length - 1))
    );
    if (isDynamic) {
      const dynamicAllocs = confirmedAttendees.length > 0
        ? calculateEqualAllocations(exp.amount_cents, confirmedAttendees)
        : [];
      expAllocs = dynamicAllocs.map((a) => ({
        id: `dyn-${exp.id}-${a.memberId}`,
        memberId: a.memberId,
        memberName: nameMap.get(a.memberId) ?? "Member",
        allocatedCents: a.allocatedCents,
        isMe: a.memberId === member.member_id,
      }));
    } else {
      expAllocs = (exp.allocations ?? []).map((a: any) => ({
        id: a.id,
        memberId: a.member_id,
        memberName: nameMap.get(a.member_id) ?? "Member",
        allocatedCents: a.allocated_cents,
        isMe: a.member_id === member.member_id,
      }));
    }

    return {
      id: exp.id,
      tripId: exp.trip_id,
      expenseType: exp.expense_type,
      payerMemberId: exp.payer_member_id,
      payerName: nameMap.get(exp.payer_member_id) ?? "Member",
      amountCents: exp.amount_cents,
      description: exp.description,
      incurredDate: exp.incurred_date,
      receiptUrl: exp.receipt_url,
      splitMode: isDynamic ? "all_attendees" : (exp.split_mode ?? "custom"),
      receiptStoragePath: exp.receipt_storage_path ?? null,
      receiptFileName: exp.receipt_file_name ?? null,
      receiptContentType: exp.receipt_content_type ?? null,
      isLocked: exp.is_locked,
      isMine: exp.payer_member_id === member.member_id,
      allocations: expAllocs,
    };
  });

  const ratePerMile = trip.trip_mileage_rate_cents ?? 50;
  const carpoolReimbursements = rawCarpools
    .filter((cp: any) => {
      const occupantCount = ((cp as any).riders ?? []).length + 1;
      return occupantCount >= 3 && cp.starting_mileage != null && cp.ending_mileage != null && cp.ending_mileage > cp.starting_mileage;
    })
    .map((cp: any) => {
      const miles = Number(cp.ending_mileage) - Number(cp.starting_mileage);
      const totalReimbursementCents = Math.round(miles * ratePerMile);
      const passengers = [cp.driver_member_id, ...((cp as any).riders ?? []).map((r: any) => r.rider_member_id)];
      const allocations = calculateEqualAllocations(totalReimbursementCents, passengers);

      return {
        carpoolId: cp.id,
        driverMemberId: cp.driver_member_id,
        driverName: nameMap.get(cp.driver_member_id) ?? "Driver",
        vehicleDescription: cp.vehicle_description,
        miles,
        rateCentsPerMile: ratePerMile,
        amountCents: totalReimbursementCents,
        occupantCount: passengers.length,
        allocations: allocations.map((a) => ({
          memberId: a.memberId,
          memberName: nameMap.get(a.memberId) ?? "Member",
          allocatedCents: a.allocatedCents,
          isMe: a.memberId === member.member_id,
        })),
      };
    });

  const cabinPayerId = trip.cabin_payer_member_id || (rsvpsResult.data ?? []).find((r: any) => r.deposit_status === "exempt")?.member_id || null;
  const depositAmountPerPerson = trip.deposit_amount_cents ?? 5000;
  const verifiedDeposits: ExternalPaymentInput[] = [];
  const depositPaidMap = new Map<string, number>();
  let totalDepositsReceivedByCabinPayer = 0;

  if (cabinPayerId) {
    for (const r of (rsvpsResult.data ?? [])) {
      if (r.member_id !== cabinPayerId && (r.deposit_status === "confirmed" || r.deposit_status === "confirmed_by_admin")) {
        verifiedDeposits.push({
          payerMemberId: r.member_id,
          recipientMemberId: cabinPayerId,
          amountCents: depositAmountPerPerson,
        });
        depositPaidMap.set(r.member_id, depositAmountPerPerson);
        totalDepositsReceivedByCabinPayer += depositAmountPerPerson;
      }
    }
  }

  let cabinDeposit = null;
  if (cabinPayerId && confirmedAttendees.length > 0) {
    const confirmedDepositCount = (rsvpsResult.data ?? []).filter(
      (r: any) => r.member_id !== cabinPayerId && (r.deposit_status === "confirmed" || r.deposit_status === "confirmed_by_admin")
    ).length;
    cabinDeposit = {
      payerMemberId: cabinPayerId,
      payerName: nameMap.get(cabinPayerId) ?? "Cabin Payer",
      depositPerPersonCents: depositAmountPerPerson,
      confirmedCount: confirmedDepositCount,
      expectedCount: Math.max(0, confirmedAttendees.length - 1),
      amountCents: confirmedDepositCount * depositAmountPerPerson,
    };
  }

  let settlementRun = null;
  let balances: any[] = [];
  let transfers: any[] = [];

  if (isFinalized && latestRun) {
    settlementRun = {
      id: latestRun.id,
      versionNo: latestRun.version_no,
      status: latestRun.status,
      totalExpensesCents: latestRun.total_expenses_cents,
      algorithmUsed: latestRun.algorithm_used,
      finalizedAt: latestRun.finalized_at,
      settledAt: latestRun.settled_at,
    };

    balances = (latestRun.balances ?? []).map((b: any) => ({
      memberId: b.member_id,
      displayName: nameMap.get(b.member_id) ?? "Member",
      totalPaidCents: b.total_paid_cents,
      totalAllocatedCents: b.total_allocated_cents,
      netBalanceCents: b.net_balance_cents,
      depositPaidCents: depositPaidMap.get(b.member_id) ?? 0,
      depositReceivedCents: b.member_id === cabinPayerId ? totalDepositsReceivedByCabinPayer : 0,
      isMe: b.member_id === member.member_id,
    }));

    transfers = (latestRun.transfers ?? []).map((t: any) => {
      const pm = paymentMethodsByMember.get(t.recipient_member_id);
      return {
        id: t.id,
        payerMemberId: t.payer_member_id,
        payerName: nameMap.get(t.payer_member_id) ?? "Payer",
        recipientMemberId: t.recipient_member_id,
        recipientName: nameMap.get(t.recipient_member_id) ?? "Recipient",
        amountCents: t.amount_cents,
        status: t.status,
        markedSentAt: t.marked_sent_at,
        confirmedReceivedAt: t.confirmed_received_at,
        paymentMethod: t.payment_method ?? pm?.method ?? null,
        recipientPreferredMethod: pm?.label ?? "Zelle / Venmo",
        notes: t.notes,
        isPayer: t.payer_member_id === member.member_id,
        isRecipient: t.recipient_member_id === member.member_id,
      };
    });
  } else {
    const engineExpenses: ExpenseInput[] = [];

    for (const exp of rawExpenses) {
      let expAllocations: Array<{ memberId: string; allocatedCents: number }>;
      const isDynamic = !isFinalized && (
        exp.split_mode === "all_attendees" ||
        (!exp.is_locked && (exp.allocations ?? []).length >= Math.max(2, confirmedAttendees.length - 1))
      );
      if (isDynamic) {
        const dynamicAllocs = confirmedAttendees.length > 0
          ? calculateEqualAllocations(exp.amount_cents, confirmedAttendees)
          : [];
        expAllocations = dynamicAllocs.map((a) => ({
          memberId: a.memberId,
          allocatedCents: a.allocatedCents,
        }));
      } else {
        expAllocations = (exp.allocations ?? []).map((a: any) => ({
          memberId: a.member_id,
          allocatedCents: a.allocated_cents,
        }));
      }
      engineExpenses.push({
        id: exp.id,
        payerMemberId: exp.payer_member_id,
        amountCents: exp.amount_cents,
        allocations: expAllocations,
      });
    }

    for (const cpr of carpoolReimbursements) {
      engineExpenses.push({
        id: `carpool-${cpr.carpoolId}`,
        payerMemberId: cpr.driverMemberId,
        amountCents: cpr.amountCents,
        allocations: cpr.allocations.map((a: any) => ({
          memberId: a.memberId,
          allocatedCents: a.allocatedCents,
        })),
      });
    }

    try {
      if (memberIdSet.size > 0 && engineExpenses.length > 0) {
        const draftResult = computeSettlement(Array.from(memberIdSet), engineExpenses, verifiedDeposits);
        balances = draftResult.balances.map((b) => ({
          memberId: b.memberId,
          displayName: nameMap.get(b.memberId) ?? "Member",
          totalPaidCents: b.totalPaidCents,
          totalAllocatedCents: b.totalAllocatedCents,
          netBalanceCents: b.netBalanceCents,
          depositPaidCents: depositPaidMap.get(b.memberId) ?? 0,
          depositReceivedCents: b.memberId === cabinPayerId ? totalDepositsReceivedByCabinPayer : 0,
          isMe: b.memberId === member.member_id,
        }));

        transfers = draftResult.transfers.map((t, idx) => {
          const pm = paymentMethodsByMember.get(t.recipientMemberId);
          return {
            id: `draft-${idx}`,
            payerMemberId: t.payerMemberId,
            payerName: nameMap.get(t.payerMemberId) ?? "Payer",
            recipientMemberId: t.recipientMemberId,
            recipientName: nameMap.get(t.recipientMemberId) ?? "Recipient",
            amountCents: t.amountCents,
            status: "outstanding",
            markedSentAt: null,
            confirmedReceivedAt: null,
            paymentMethod: pm?.method ?? null,
            recipientPreferredMethod: pm?.label ?? "Zelle / Venmo",
            notes: null,
            isPayer: t.payerMemberId === member.member_id,
            isRecipient: t.recipientMemberId === member.member_id,
          };
        });

        settlementRun = {
          id: null,
          versionNo: 0,
          status: "draft",
          totalExpensesCents: draftResult.totalExpensesCents,
          algorithmUsed: draftResult.algorithmUsed,
          finalizedAt: null,
          settledAt: null,
        };
      }
    } catch {
      // Incomplete draft allocations
    }
  }

  return {
    tripId,
    expenses,
    carpoolReimbursements,
    cabinDeposit,
    settlementRun,
    balances,
    transfers,
    isFinalized,
  };
}

async function getTripActivities(member: Member, tripId: string): Promise<Record<string, unknown>> {
  const trip = await service.from("camping_trips").select("id").eq("id", tripId).is("deleted_at", null).maybeSingle();
  checkError(trip.error);
  if (!trip.data) {
    throw Object.assign(new Error("trip not found"), { status: 404, code: "22023" });
  }

  const { data: activities, error } = await service
    .from("trip_activities")
    .select(`
      *,
      participants:trip_activity_participants(*),
      groups:trip_activity_groups(
        *,
        members:trip_activity_group_members(*)
      ),
      swap_requests:trip_activity_swap_requests(*)
    `)
    .eq("trip_id", tripId)
    .order("activity_date", { ascending: true })
    .order("start_time", { ascending: true });
  checkError(error);

  const rawActivities = activities ?? [];
  const memberIdSet = new Set<string>();

  const { data: tripRsvps } = await service
    .from("trip_rsvps")
    .select("member_id")
    .eq("trip_id", tripId)
    .eq("response", "coming");

  for (const r of tripRsvps ?? []) {
    if (r.member_id) memberIdSet.add(r.member_id);
  }

  for (const act of rawActivities) {
    for (const p of act.participants ?? []) {
      if (p.member_id) memberIdSet.add(p.member_id);
    }
    for (const g of act.groups ?? []) {
      if (g.purchaser_member_id) memberIdSet.add(g.purchaser_member_id);
      for (const m of g.members ?? []) {
        if (m.member_id) memberIdSet.add(m.member_id);
      }
    }
    for (const s of act.swap_requests ?? []) {
      if (s.requester_member_id) memberIdSet.add(s.requester_member_id);
      if (s.target_member_id) memberIdSet.add(s.target_member_id);
    }
  }

  const memberProfileMap = new Map<string, string>();
  if (memberIdSet.size > 0) {
    const { data: profiles } = await service
      .from("member_profiles")
      .select("member_id, display_name")
      .in("member_id", Array.from(memberIdSet));
    for (const p of profiles ?? []) {
      memberProfileMap.set(p.member_id, p.display_name);
    }
  }

  const isAdmin = member.member_role === "admin" || member.member_role === "administrator";
  const isAccountant = member.member_role === "accountant";

  const sanitizedActivities = rawActivities.map((act: any) => {
    const participants = (act.participants ?? []).map((p: any) => ({
      ...p,
      display_name: memberProfileMap.get(p.member_id) ?? null,
    }));

    const sortedGroups = (act.groups ?? []).sort((a: any, b: any) => (a.group_number ?? 0) - (b.group_number ?? 0));
    const groups = sortedGroups.map((g: any) => {
      const isAssigned = (g.members ?? []).some((m: any) => m.member_id === member.member_id) || g.purchaser_member_id === member.member_id;
      const groupMembers = (g.members ?? []).map((m: any) => ({
        ...m,
        display_name: memberProfileMap.get(m.member_id) ?? null,
      }));

      return {
        ...g,
        purchaser_display_name: g.purchaser_member_id ? (memberProfileMap.get(g.purchaser_member_id) ?? null) : null,
        members: groupMembers,
        voucher_code: (isAdmin || isAccountant || isAssigned) ? g.voucher_code : null,
        security_pin: (isAdmin || isAccountant || isAssigned) ? g.security_pin : null,
      };
    });

    const swapRequests = (act.swap_requests ?? []).map((s: any) => ({
      ...s,
      requester_display_name: memberProfileMap.get(s.requester_member_id) ?? null,
      target_display_name: memberProfileMap.get(s.target_member_id) ?? null,
    }));

    const tripAttendees = (tripRsvps ?? []).map((r: any) => ({
      member_id: r.member_id,
      display_name: memberProfileMap.get(r.member_id) ?? "Camper",
    }));

    return {
      ...act,
      participants,
      trip_attendees: tripAttendees,
      groups,
      swap_requests: swapRequests,
    };
  });

  const tripAttendees = (tripRsvps ?? []).map((r: any) => ({
    member_id: r.member_id,
    display_name: memberProfileMap.get(r.member_id) ?? "Camper",
  }));

  return {
    tripId,
    activities: sanitizedActivities,
    tripAttendees,
  };
}

async function getConstitution(member: Member, tripId?: string): Promise<Record<string, unknown>> {
  const definitionQuery = service.from("rule_definitions").select("id,stable_key,category,scope,trip_id,active,created_at").order("stable_key");
  const { data: allDefinitions, error: definitionsError } = await definitionQuery;
  checkError(definitionsError);
  const definitions = (allDefinitions ?? []).filter((definition) => definition.scope === "general" || definition.trip_id === tripId);
  const definitionIds = definitions.map((definition) => definition.id);
  const versionResult = definitionIds.length
    ? await service.from("rule_versions").select("id,definition_id,version_no,human_text,structured_values,effective_from,expires_at,created_by,created_at").in("definition_id", definitionIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  checkError(versionResult.error);
  let bundle: Record<string, unknown> | null = null;
  let acknowledgments: unknown[] = [];
  let overrides: unknown[] = [];
  if (tripId) {
    const [{ data: currentBundle, error: bundleError }, { data: ackRows, error: ackError }] = await Promise.all([
      service.from("trip_rule_bundles").select("id,version_no,content_hash,rendered_bundle,created_at").eq("trip_id", tripId).eq("is_current", true).maybeSingle(),
      service.from("trip_rule_acknowledgments").select("id,bundle_id,content_hash,statement_version,acknowledged_at").eq("trip_id", tripId).eq("member_id", member.member_id).order("acknowledged_at", { ascending: false }),
    ]);
    checkError(bundleError); checkError(ackError);
    if (currentBundle) bundle = { id: currentBundle.id, version: currentBundle.version_no, contentHash: currentBundle.content_hash, rules: currentBundle.rendered_bundle, createdAt: currentBundle.created_at };
    acknowledgments = ackRows ?? [];
    if (member.member_role === "admin") {
      const { data, error } = await service.from("trip_rule_overrides").select("id,general_rule_definition_id,base_rule_version_id,version_no,human_text,structured_values,expires_at,reason,created_at,retired_at").eq("trip_id", tripId).order("created_at", { ascending: false });
      checkError(error); overrides = data ?? [];
    }
  }
  return {
    definitions,
    versions: versionResult.data ?? [],
    currentBundle: bundle,
    myAcknowledgments: acknowledgments,
    overrides,
  };
}

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
  if (request.method !== "POST" || !isOriginAllowed(request)) return errorResponse(request, 405, "request_not_allowed", requestId);
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return errorResponse(request, 401, "unauthorized", requestId);
  const { data: authData, error: authError } = await service.auth.getUser(match[1]);
  const authUser = authData.user;
  if (authError || !authUser?.email || !authUser.email_confirmed_at) return errorResponse(request, 401, "verified_member_session_required", requestId);
  const { data: member, error: memberError } = await service.from("member_profiles")
    .select("member_id,auth_user_id,member_role,account_status").eq("auth_user_id", authUser.id).maybeSingle<Member>();
  if (memberError) return errorResponse(request, 500, "membership_lookup_failed", requestId);
  if (!member || member.account_status !== "active") return errorResponse(request, 403, "active_membership_required", requestId);
  let parsed: z.infer<typeof requestSchema>;
  try { parsed = await readBody(request, requestSchema); }
  catch { return errorResponse(request, 400, "invalid_request", requestId); }
  const action = parsed.action;
  if (action === "verify_deposit") {
    if (member.member_role !== "admin" && member.member_role !== "accountant") {
      return errorResponse(request, 403, "admin_or_accountant_required", requestId);
    }
  } else if (adminActions.has(action) && member.member_role !== "admin") {
    return errorResponse(request, 403, "administrator_required", requestId);
  }
  let input: Record<string, unknown>;
  try {
    input = inputSchemas[action].parse(parsed.input ?? {}) as Record<string, unknown>;
  } catch (zodErr) {
    const errorMsg = zodErr instanceof z.ZodError
      ? zodErr.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
      : "Invalid input parameters";
    return errorResponse(request, 400, "invalid_request", requestId, errorMsg);
  }

  if (action === "get_calendar") {
    try { return json(request, 200, { ...(await getCalendar(member)), requestId }); }
    catch { return errorResponse(request, 500, "calendar_read_failed", requestId); }
  }
  if (action === "get_constitution") {
    try {
      if (input.tripId) {
        const { error } = await service.rpc("phase2_refresh_open_rule_bundles", { p_actor_id: member.member_id, p_trip_ids: [input.tripId] });
        checkError(error);
      }
      return json(request, 200, { ...(await getConstitution(member, input.tripId as string | undefined)), requestId });
    }
    catch { return errorResponse(request, 500, "constitution_read_failed", requestId); }
  }
  if (action === "get_trip_details") {
    try {
      return json(request, 200, { ...(await getTripDetails(member, input.tripId as string)), requestId });
    } catch (error: unknown) {
      console.error("get_trip_details failed:", error);
      const err = error as { message?: string; code?: string; status?: number } | null;
      if (err?.message === "trip not found" || err?.code === "22023" || err?.status === 404) {
        return errorResponse(request, 404, "trip_not_found", requestId);
      }
      return errorResponse(request, 500, "trip_details_read_failed", requestId, err?.message);
    }
  }
  if (action === "get_trip_logistics") {
    try {
      return json(request, 200, { ...(await getTripLogistics(member, input.tripId as string)), requestId });
    } catch {
      return errorResponse(request, 500, "trip_logistics_read_failed", requestId);
    }
  }
  if (action === "get_trip_financials") {
    try {
      return json(request, 200, { ...(await getTripFinancials(member, input.tripId as string)), requestId });
    } catch {
      return errorResponse(request, 500, "trip_financials_read_failed", requestId);
    }
  }
  if (action === "admin_list_master_responsibilities") {
    try {
      let query = service.from("master_responsibilities").select("*").order("category", { ascending: true }).order("title", { ascending: true });
      if (!input.includeInactive) {
        query = query.eq("active", true);
      }
      const { data, error } = await query;
      checkError(error);
      return json(request, 200, { responsibilities: data ?? [], requestId });
    } catch {
      return errorResponse(request, 500, "master_responsibilities_read_failed", requestId);
    }
  }
  if (action === "get_trip_activities") {
    try {
      return json(request, 200, { ...(await getTripActivities(member, input.tripId as string)), requestId });
    } catch (err: unknown) {
      console.error("get_trip_activities failed:", err);
      const error = err as { message?: string; code?: string; status?: number } | null;
      if (error?.message === "trip not found" || error?.code === "22023" || error?.status === 404) {
        return errorResponse(request, 404, "trip_not_found", requestId);
      }
      return errorResponse(request, 500, "trip_activities_read_failed", requestId, error?.message);
    }
  }
  if (action === "get_master_catalogs") {
    try {
      const includeInactive = Boolean((input as any)?.includeInactive);
      let gearQuery = service.from("master_gear").select("*").order("gear_type", { ascending: true }).order("category", { ascending: true }).order("name", { ascending: true });
      let foodQuery = service.from("master_food_groceries").select("*").order("category", { ascending: true }).order("name", { ascending: true });
      let respQuery = service.from("master_responsibilities").select("*").order("category", { ascending: true }).order("title", { ascending: true });
      let actQuery = service.from("master_activities").select("*").order("category", { ascending: true }).order("title", { ascending: true });
      if (!includeInactive) {
        gearQuery = gearQuery.eq("active", true);
        foodQuery = foodQuery.eq("active", true);
        respQuery = respQuery.eq("active", true);
        actQuery = actQuery.eq("is_active", true);
      }
      const [gearRes, foodRes, respRes, actRes] = await Promise.all([gearQuery, foodQuery, respQuery, actQuery]);
      checkError(gearRes.error);
      checkError(foodRes.error);
      checkError(respRes.error);
      checkError(actRes.error);
      return json(request, 200, {
        gear: gearRes.data ?? [],
        food: foodRes.data ?? [],
        responsibilities: respRes.data ?? [],
        activities: actRes.data ?? [],
        requestId,
      });
    } catch {
      return errorResponse(request, 500, "master_catalogs_read_failed", requestId);
    }
  }
  if (action === "get_master_activities") {
    try {
      const includeInactive = Boolean((input as any)?.includeInactive);
      let actQuery = service.from("master_activities").select("*").order("category", { ascending: true }).order("title", { ascending: true });
      if (!includeInactive) {
        actQuery = actQuery.eq("is_active", true);
      }
      const { data, error } = await actQuery;
      checkError(error);
      return json(request, 200, { activities: data ?? [], requestId });
    } catch {
      return errorResponse(request, 500, "master_activities_read_failed", requestId);
    }
  }
  if (action === "get_trip_time_slots") {
    try {
      const trip = await service.from("camping_trips").select("version").eq("id", input.tripId).is("deleted_at", null).single();
      checkError(trip.error);
      const { data, error } = await service
        .from("trip_time_slots")
        .select(`
          id,
          trip_id,
          slot_date,
          time_block,
          slot_type,
          label,
          is_custom,
          is_enabled,
          sort_order,
          created_at,
          updated_at,
          duties:trip_slot_duties(
            id,
            time_slot_id,
            master_responsibility_id,
            capacity,
            workload_weight,
            is_active,
            created_at,
            updated_at,
            responsibility:master_responsibilities(
              id,
              title,
              description,
              category,
              default_capacity,
              workload_weight,
              active
            )
          )
        `)
        .eq("trip_id", input.tripId)
        .order("slot_date", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      checkError(error);
      const assignments = await service.from("trip_duty_assignments").select("slot_duty_id").eq("trip_id", input.tripId).in("status", ["claimed", "assigned_by_admin"]);
      checkError(assignments.error);
      return json(request, 200, { timeSlots: data ?? [], tripVersion: trip.data.version, assignedDutyIds: [...new Set((assignments.data ?? []).map(row => row.slot_duty_id))], requestId });
    } catch {
      return errorResponse(request, 500, "trip_time_slots_read_failed", requestId);
    }
  }
  if (action === "get_trip_task_matrix") {
    try {
      const tripId = input.tripId as string;
      const [slotsResult, assignmentsResult, creditsResult, quotaResult, attendeesResult, dailyResult, mealPrefsResult] = await Promise.all([
        service
          .from("trip_time_slots")
          .select(`
            id,
            trip_id,
            slot_date,
            time_block,
            slot_type,
            label,
            is_custom,
            is_enabled,
            sort_order,
            created_at,
            updated_at,
            duties:trip_slot_duties(
              id,
              time_slot_id,
              master_responsibility_id,
              capacity,
              workload_weight,
              is_active,
              created_at,
              updated_at,
              responsibility:master_responsibilities(
                id,
                title,
                description,
                category,
                default_capacity,
                workload_weight,
                active
              )
            )
          `)
          .eq("trip_id", tripId)
          .order("slot_date", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        service
          .from("trip_duty_assignments")
          .select(`
            id,
            trip_id,
            slot_duty_id,
            member_id,
            status,
            claimed_at,
            released_at,
            release_reason,
            member:member_profiles!trip_duty_assignments_member_id_fkey(
              member_id,
              display_name
            )
          `)
          .eq("trip_id", tripId)
          .in("status", ["claimed", "assigned_by_admin"]),
        service
          .from("trip_driver_credits")
          .select("id, trip_id, member_id, workload_credit, status, notes")
          .eq("trip_id", tripId)
          .eq("status", "approved"),
        service.rpc("phase3_get_member_quota_progress", {
          p_trip_id: tripId,
          p_member_id: member.member_id,
        }),
        service
          .from("trip_rsvps")
          .select(`
            member_id,
            response,
            member:member_profiles!trip_rsvps_member_id_fkey(
              member_id,
              display_name
            )
          `)
          .eq("trip_id", tripId)
          .eq("response", "coming"),
        service.rpc("phase3_get_daily_workload_progress", { p_trip_id: tripId, p_member_id: member.member_id }),
        service
          .from("trip_meal_preferences")
          .select("id, trip_id, member_id, saturday_beverage, sunday_beverage, default_diet, meal_choices, allergies_notes, alcohol_beverages, created_at, updated_at")
          .eq("trip_id", tripId),
      ]);

      checkError(dailyResult.error);
      checkError(slotsResult.error);
      checkError(assignmentsResult.error);
      checkError(creditsResult.error);
      checkError(quotaResult.error);
      checkError(attendeesResult.error);
      checkError(mealPrefsResult.error);

      const comingMemberIds = (attendeesResult.data ?? []).map((row) => row.member_id);
      const allPrefs = (mealPrefsResult.data ?? []) as MealPreferenceRecord[];
      const ownPreference = allPrefs.find((p) => p.member_id === member.member_id);
      const mealSlots = (slotsResult.data ?? []).filter((s: any) => s.slot_type === "meal" && s.is_enabled !== false);
      const mealHeadcounts = computeMealHeadcounts(comingMemberIds, allPrefs, mealSlots);

      return json(request, 200, {
        timeSlots: slotsResult.data ?? [],
        activeAssignments: assignmentsResult.data ?? [],
        driverCredits: creditsResult.data ?? [],
        myQuotaProgress: quotaResult.data ?? null,
        myDailyWorkload: dailyResult.data,
        confirmedAttendees: (attendeesResult.data ?? []).map((row) => ({
          memberId: row.member_id,
          displayName: (row.member as { display_name?: string } | null)?.display_name ?? "Member",
        })),
        myMealPreferences: formatMealPreferences(ownPreference),
        mealHeadcounts,
        requestId,
      });
    } catch (err: unknown) {
      console.error("get_trip_task_matrix failed:", err);
      return errorResponse(request, 500, "trip_task_matrix_read_failed", requestId, (err as Error)?.message);
    }
  }

  if (action === "save_meal_preferences") {
    try {
      const tripId = input.tripId as string;
      const { data: rsvp, error: rsvpError } = await service
        .from("trip_rsvps")
        .select("response")
        .eq("trip_id", tripId)
        .eq("member_id", member.member_id)
        .maybeSingle();

      if (rsvpError) {
        return errorResponse(request, 500, "rsvp_lookup_failed", requestId, rsvpError.message);
      }

      if (!rsvp || rsvp.response !== "coming") {
        return errorResponse(
          request,
          403,
          "forbidden",
          requestId,
          "Only confirmed coming attendees can save meal preferences"
        );
      }

      const { data, error } = await service
        .from("trip_meal_preferences")
        .upsert(
          {
            trip_id: tripId,
            member_id: member.member_id,
            saturday_beverage: input.saturdayBeverage,
            sunday_beverage: input.sundayBeverage,
            default_diet: input.defaultDiet,
            meal_choices: input.mealChoices ?? {},
            allergies_notes: typeof input.allergiesNotes === "string" ? (input.allergiesNotes.trim() || null) : null,
            alcohol_beverages: input.alcoholBeverages ?? [],
            updated_at: new Date().toISOString(),
          },
          { onConflict: "trip_id,member_id" }
        )
        .select()
        .single();

      if (error) {
        return errorResponse(request, databaseStatus(error.code), "save_meal_preferences_failed", requestId, error.message);
      }

      return json(request, 200, {
        success: true,
        preferences: formatMealPreferences(data as MealPreferenceRecord),
        requestId,
      });
    } catch (err: unknown) {
      const error = err as Error;
      return errorResponse(request, 500, "save_meal_preferences_failed", requestId, error?.message);
    }
  }

  const keyResult = uuid.safeParse(request.headers.get("Idempotency-Key"));
  if (mutatingActions.has(action) && !keyResult.success) return errorResponse(request, 400, "idempotency_key_required", requestId);
  const key = keyResult.success ? keyResult.data : "";
  const aggregate = aggregateId(action, input, member.member_id);
  let idempotency: IdempotencyClaim | null = null;
  if (mutatingActions.has(action)) {
    try { idempotency = await claim(authUser.id, action, aggregate, key, input); }
    catch { return errorResponse(request, 409, "idempotency_conflict_or_expired", requestId); }
    if (idempotency.state === "replay") return json(request, 200, { replayed: true, operation: action, resultId: idempotency.resultId ?? null, requestId });
    if (idempotency.state === "in_progress") return errorResponse(request, 409, "request_in_progress_retry_same_key", requestId);
  }

  let rpcName: string;
  let rpcArgs: Record<string, unknown>;
  switch (action) {
    case "admin_set_daily_workload_target":
      rpcName = "phase3_set_daily_workload_target";
      rpcArgs = { p_actor_id: member.member_id, p_trip_id: input.tripId, p_target: input.target, p_expected_version: input.expectedVersion, p_request_id: key };
      break;
    case "admin_transition_trip_lifecycle":
      rpcName = "phase3_transition_trip_lifecycle";
      rpcArgs = {
        p_actor_id: member.member_id,
        p_trip_id: input.tripId,
        p_to_status: input.toStatus,
        p_reason: input.reason ?? null,
        p_expected_version: input.expectedVersion ?? null,
      };
      break;
    case "admin_update_cabin_reservation":
      rpcName = "phase3_update_cabin_reservation";
      rpcArgs = {
        p_actor_id: member.member_id,
        p_trip_id: input.tripId,
        p_status: input.status,
        p_reservation_reference: input.reservationReference ?? null,
        p_provider_label: input.providerLabel ?? null,
        p_paid_by_member_id: input.paidByMemberId ?? null,
        p_amount_cents: input.reservationAmountCents ?? 0,
        p_cabin_count: input.cabinCount ?? 1,
        p_per_cabin_capacity: input.perCabinCapacity ?? 6,
        p_notes: input.cancellationNotes ?? null,
      };
      break;
    case "get_trip_lifecycle":
      rpcName = "phase3_get_trip_lifecycle";
      rpcArgs = {
        p_trip_id: input.tripId,
      };
      break;
    case "manage_trip_commitment":
    case "manage_trip_commitments":
      if (input.action === "toggle_active") {
        rpcName = "update_trip_commitment_status";
        rpcArgs = {
          p_commitment_id: input.commitmentId,
          p_is_active: input.isActive ?? true,
          p_actor_id: member.member_id,
        };
      } else {
        rpcName = "phase4_manage_commitment";
        rpcArgs = {
          p_trip_id: input.tripId,
          p_action: input.action,
          p_commitment_id: input.commitmentId ?? null,
          p_category: input.category ?? null,
          p_item_name: input.itemName ?? null,
          p_quantity: input.quantityDescription ?? null,
          p_is_critical: input.isCritical ?? false,
          p_assigned_member_id: input.assignedMemberId ?? null,
          p_actor_id: member.member_id,
          p_is_admin: member.member_role === "admin",
        };
      }
      break;
    case "admin_manage_carpool":
      rpcName = "phase4_manage_carpool";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_action: input.action,
        p_carpool_id: input.carpoolId ?? null,
        p_driver_member_id: input.driverMemberId ?? null,
        p_vehicle_description: input.vehicleDescription ?? null,
        p_max_seats: input.maxSeats ?? 4,
        p_starting_mileage: input.startingMileage ?? null,
        p_ending_mileage: input.endingMileage ?? null,
        p_departure_details: input.departureDetails ?? null,
        p_rider_member_ids: input.riderMemberIds ?? [],
        p_actor_id: member.member_id,
        p_is_admin: member.member_role === "admin",
      };
      break;
    case "record_carpool_mileage":
      rpcName = "phase4_manage_carpool";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_action: "record_mileage",
        p_carpool_id: input.carpoolId,
        p_starting_mileage: input.startingMileage ?? null,
        p_ending_mileage: input.endingMileage ?? null,
        p_actor_id: member.member_id,
        p_is_admin: member.member_role === "admin",
      };
      break;
    case "admin_override_duty":
      rpcName = "phase4_admin_override_duty";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_duty_id: input.dutyId,
        p_target_member_id: input.targetMemberId,
        p_action: input.action,
        p_actor_id: member.member_id,
        p_reason: input.reason ?? "Administrator duty override",
      };
      break;
    case "admin_configure_club":
      rpcName = "phase2_configure_club";
      rpcArgs = { p_actor_id: member.member_id, p_timezone: input.timezone, p_lead_days: input.leadDays, p_close_time: input.closeTime, p_default_minimum: input.defaultMinimumParticipants, p_next_rotation_position: input.nextRotationPosition, p_expected_version: input.expectedVersion, p_request_id: key };
      break;
    case "admin_generate_calendar":
      rpcName = "phase2_generate_calendar";
      rpcArgs = { p_actor_id: member.member_id, p_through_month: `${input.throughMonth}-01`, p_request_id: key };
      break;
    case "admin_reorder_campsites":
      rpcName = "phase2_admin_reorder_campsites";
      rpcArgs = { p_actor_id: member.member_id, p_order: input.order, p_next_rotation_position: input.nextRotationPosition, p_reason: input.reason, p_request_id: key };
      break;
    case "admin_update_campsite": {
      rpcName = "phase2_admin_update_campsite";
      const { campsiteId, reason: why, ...campsiteInput } = input;
      rpcArgs = { p_actor_id: member.member_id, p_campsite_id: campsiteId, p_input: campsiteInput, p_reason: why, p_request_id: key };
      break;
    }
    case "admin_create_campsite": {
      rpcName = "phase2_admin_create_campsite";
      const { reason: why, ...campsiteInput } = input;
      rpcArgs = { p_actor_id: member.member_id, p_input: campsiteInput, p_reason: why, p_request_id: key };
      break;
    }
    case "admin_delete_campsite": {
      rpcName = "phase2_admin_delete_campsite";
      rpcArgs = {
        p_actor_id: member.member_id,
        p_campsite_id: input.campsiteId,
        p_reason: input.reason,
        p_request_id: key,
      };
      break;
    }
    case "admin_configure_trip":
      rpcName = "phase2_admin_configure_trip";
      rpcArgs = {
        p_actor_id: member.member_id,
        p_trip_id: input.tripId,
        p_starts_on: input.startsOn,
        p_ends_on: input.endsOn,
        p_deadline_date: input.deadlineDate,
        p_deadline_time: input.deadlineTime,
        p_minimum_participants: input.minimumParticipants,
        p_max_capacity: input.maxCapacity,
        p_selected_campsite_id: input.selectedCampsiteId,
        p_cabin_booking_status: input.cabinBookingStatus,
        p_additional_information: input.additionalInformation,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_request_id: key,
        p_title: input.title ?? null,
        p_event_status: input.eventStatus ?? "tentative",
        p_camping_type: input.campingType ?? "cabin",
        p_cabin_count: input.cabinCount ?? null,
        p_per_cabin_capacity: input.perCabinCapacity ?? 6,
      };
      break;
    case "admin_delete_trip":
      rpcName = "phase2_admin_delete_trip";
      rpcArgs = {
        p_actor_id: member.member_id,
        p_trip_id: input.tripId,
        p_reason: input.reason,
        p_request_id: key,
      };
      break;
    case "admin_create_custom_trip":
      rpcName = "phase2_admin_create_custom_trip";
      rpcArgs = {
        p_actor_id: member.member_id,
        p_title: input.title,
        p_starts_on: input.startsOn,
        p_ends_on: input.endsOn,
        p_selected_campsite_id: input.selectedCampsiteId,
        p_camping_type: input.campingType ?? "cabin",
        p_sites_count: input.sitesCount ?? 2,
        p_site_capacity: input.siteCapacity ?? 6,
        p_event_status: input.eventStatus ?? "tentative",
        p_booking_status: input.cabinBookingStatus ?? input.bookingStatus ?? "booked",
        p_minimum_participants: input.minimumParticipants ?? 4,
        p_max_capacity: input.maxCapacity ?? null,
        p_deadline_date: input.deadlineDate ?? null,
        p_deadline_time: input.deadlineTime ?? null,
        p_additional_information: input.additionalInformation ?? "",
        p_reason: input.reason,
        p_request_id: key,
      };
      break;
    case "admin_set_poll_status":
      rpcName = "phase2_admin_set_poll_status";
      rpcArgs = { p_actor_id: member.member_id, p_trip_id: input.tripId, p_status: input.pollStatus, p_expected_version: input.expectedVersion, p_reason: input.reason, p_request_id: key };
      break;
    case "admin_publish_rule":
      rpcName = "phase2_admin_publish_rule";
      rpcArgs = { p_actor_id: member.member_id, p_scope: input.scope, p_trip_id: input.tripId ?? null, p_stable_key: input.stableKey, p_category: input.category, p_human_text: input.text, p_structured_values: input.structuredValues, p_effective_from: input.effectiveFrom, p_expires_at: input.expiresAt, p_reason: input.reason, p_request_id: key };
      break;
    case "admin_set_rule_override":
      rpcName = "phase2_admin_set_rule_override";
      rpcArgs = { p_actor_id: member.member_id, p_trip_id: input.tripId, p_base_rule_version_id: input.baseRuleVersionId, p_human_text: input.text, p_structured_values: input.structuredValues, p_expires_at: input.expiresAt, p_reason: input.reason, p_request_id: key };
      break;
    case "submit_rsvp": {
      if (input.response === "coming") {
        const [capacityResult, countResult] = await Promise.all([
          service.rpc("trip_effective_capacity", { p_trip_id: input.tripId }),
          service.from("trip_rsvps")
            .select("member_id", { count: "exact" })
            .eq("trip_id", input.tripId)
            .eq("response", "coming"),
        ]);
        checkError(capacityResult.error);
        checkError(countResult.error);
        const effectiveCapacity = capacityResult.data as number | null;
        const comingCount = countResult.count ?? 0;

        if (effectiveCapacity !== null && comingCount >= effectiveCapacity) {
          const alreadyComing = await service.from("trip_rsvps")
            .select("id").eq("trip_id", input.tripId)
            .eq("member_id", member.member_id).eq("response", "coming").maybeSingle();
          checkError(alreadyComing.error);
          if (!alreadyComing.data) {
            const { data: waitlistResult, error: waitlistError } = await service.rpc("trip_api_join_waitlist", {
              p_trip_id: input.tripId,
              p_member_id: member.member_id,
              p_request_id: key,
            });
            checkError(waitlistError);
            try {
              await finish(authUser.id, action, aggregate, key, input, (waitlistResult as { entryId?: string })?.entryId ?? null);
            } catch {
              return errorResponse(request, 500, "idempotency_completion_failed", requestId);
            }
            return json(request, 200, { waitlisted: true, position: (waitlistResult as { position: number }).position, requestId });
          }
        }
      }
      rpcName = "phase2_submit_rsvp";
      rpcArgs = { p_auth_user_id: authUser.id, p_trip_id: input.tripId, p_response: input.response, p_bundle_id: input.bundleId ?? null, p_content_hash: input.contentHash ?? null, p_expected_version: input.expectedVersion, p_request_id: key };
      break;
    }
    case "admin_record_interest":
      rpcName = "phase2_admin_record_interest";
      rpcArgs = { p_actor_id: member.member_id, p_trip_id: input.tripId, p_member_id: input.memberId, p_response: input.response, p_expected_version: input.expectedVersion, p_reason: input.reason, p_request_id: key };
      break;
    case "request_withdrawal":
      rpcName = "phase2_request_withdrawal";
      rpcArgs = { p_auth_user_id: authUser.id, p_trip_id: input.tripId, p_reason: input.reason, p_request_id: key };
      break;
    case "admin_promote_from_waitlist": {
      const { data: result, error } = await service.rpc("trip_api_promote_from_waitlist", {
        p_trip_id: input.tripId,
        p_member_id: input.memberId,
        p_actor_id: member.member_id,
      });
      if (error?.message?.includes("member_not_on_waitlist")) return errorResponse(request, 404, "member_not_on_waitlist", requestId);
      if (error?.code === "23514") return errorResponse(request, 409, "trip_at_capacity", requestId);
      checkError(error);
      try {
        await finish(authUser.id, action, aggregate, key, input, null);
      } catch {
        return errorResponse(request, 500, "idempotency_completion_failed", requestId);
      }
      return json(request, 200, { promoted: true, requestId });
    }
    case "admin_create_master_responsibility":
      rpcName = "phase3_admin_create_master_responsibility";
      rpcArgs = {
        p_title: input.title,
        p_description: input.description ?? null,
        p_category: input.category,
        p_default_capacity: input.defaultCapacity,
        p_workload_weight: input.workloadWeight,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_update_master_responsibility":
      rpcName = "phase3_admin_update_master_responsibility";
      rpcArgs = {
        p_id: input.id,
        p_title: input.title,
        p_description: input.description ?? null,
        p_category: input.category,
        p_default_capacity: input.defaultCapacity,
        p_workload_weight: input.workloadWeight,
        p_active: input.active ?? true,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_manage_master_gear":
      rpcName = "admin_manage_master_gear";
      rpcArgs = {
        p_action: input.action,
        p_id: input.id ?? null,
        p_name: input.name ?? null,
        p_description: typeof input.description !== "undefined" ? input.description : null,
        p_gear_type: input.action === "update" ? (input.gearType ?? null) : (input.gearType ?? "individual"),
        p_category: input.action === "update" ? (input.category ?? null) : (input.category ?? "other"),
        p_default_quantity: input.action === "update" ? (input.defaultQuantity ?? null) : (input.defaultQuantity ?? "1"),
        p_is_critical: input.action === "update"
          ? (typeof input.isCritical === "boolean" ? input.isCritical : null)
          : (input.isCritical ?? false),
        p_active: input.action === "update"
          ? (typeof input.active === "boolean" ? input.active : null)
          : (typeof input.active === "boolean" ? input.active : true),
        p_actor_id: member.member_id,
      };
      break;
    case "admin_manage_master_food":
      rpcName = "admin_manage_master_food";
      rpcArgs = {
        p_action: input.action,
        p_id: input.id ?? null,
        p_name: input.name ?? null,
        p_description: typeof input.description !== "undefined" ? input.description : null,
        p_category: input.action === "update" ? (input.category ?? null) : (input.category ?? "pantry"),
        p_default_quantity: input.action === "update" ? (input.defaultQuantity ?? null) : (input.defaultQuantity ?? "1 pack"),
        p_is_critical: input.action === "update"
          ? (typeof input.isCritical === "boolean" ? input.isCritical : null)
          : (input.isCritical ?? false),
        p_active: input.action === "update"
          ? (typeof input.active === "boolean" ? input.active : null)
          : (typeof input.active === "boolean" ? input.active : true),
        p_actor_id: member.member_id,
      };
      break;
    case "admin_delete_master_responsibility":
      rpcName = "admin_delete_master_responsibility";
      rpcArgs = {
        p_id: input.id,
        p_actor_id: member.member_id,
      };
      break;
    case "submit_deposit":
      rpcName = "submit_member_deposit";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_actor_id: member.member_id,
      };
      break;
    case "verify_deposit":
      rpcName = "verify_member_deposit";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_member_id: input.memberId,
        p_status: input.status ?? "confirmed_by_admin",
        p_actor_id: member.member_id,
      };
      break;
    case "admin_save_daily_responsibilities":
      rpcName = "phase3_save_daily_responsibilities";
      rpcArgs = { p_actor_id: member.member_id, p_trip_id: input.tripId, p_days: input.days, p_expected_version: input.expectedVersion, p_confirm_removal: input.confirmRemoval, p_request_id: key };
      break;
    case "admin_generate_candidate_slots":
      rpcName = "phase3_generate_candidate_time_slots";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_actor_id: member.member_id,
        p_regenerate: input.regenerate ?? false,
      };
      break;
    case "admin_configure_time_slot":
      rpcName = "phase3_admin_configure_time_slot";
      rpcArgs = {
        p_slot_id: input.slotId,
        p_label: input.label ?? null,
        p_is_enabled: input.isEnabled ?? null,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_create_custom_time_slot":
      rpcName = "phase3_admin_create_custom_time_slot";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_slot_date: input.slotDate,
        p_time_block: input.timeBlock,
        p_slot_type: input.slotType,
        p_label: input.label,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_add_slot_duty":
      rpcName = "phase3_admin_add_slot_duty";
      rpcArgs = {
        p_time_slot_id: input.timeSlotId,
        p_master_responsibility_id: input.masterResponsibilityId,
        p_capacity: input.capacity,
        p_workload_weight: input.workloadWeight,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_update_slot_duty":
      rpcName = "phase3_admin_update_slot_duty";
      rpcArgs = {
        p_slot_duty_id: input.slotDutyId,
        p_capacity: input.capacity ?? null,
        p_workload_weight: input.workloadWeight ?? null,
        p_is_active: input.isActive ?? null,
        p_actor_id: member.member_id,
      };
      break;
    case "claim_duty":
      rpcName = "phase3_claim_duty";
      rpcArgs = {
        p_slot_duty_id: input.slotDutyId,
        p_actor_id: member.member_id,
        p_acknowledge_overlap: input.acknowledgeOverlap ?? false,
      };
      break;
    case "drop_duty":
      rpcName = "phase3_drop_duty";
      rpcArgs = {
        p_assignment_id: input.assignmentId,
        p_actor_id: member.member_id,
        p_reason: input.reason ?? null,
      };
      break;
    case "admin_assign_duty":
      rpcName = "phase3_admin_assign_duty";
      rpcArgs = {
        p_slot_duty_id: input.slotDutyId,
        p_member_id: input.memberId,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_reassign_duty":
      rpcName = "phase3_admin_reassign_duty";
      rpcArgs = {
        p_assignment_id: input.assignmentId,
        p_new_member_id: input.newMemberId,
        p_actor_id: member.member_id,
        p_reason: input.reason ?? null,
      };
      break;
    case "admin_set_driver_credit":
      rpcName = "phase3_admin_set_driver_credit";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_member_id: input.memberId,
        p_workload_credit: input.workloadCredit,
        p_status: input.status,
        p_notes: input.notes ?? null,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_manage_trip_expense": {
      const splitMode = input.action === "create"
        ? ((input.splitMode as "all_attendees" | "custom" | undefined) ?? "all_attendees")
        : (input.splitMode as "all_attendees" | "custom" | undefined);
      if ((input.action === "create" || input.action === "update") && splitMode === "all_attendees") {
        const { data: attendees, error: attError } = await service.from("trip_rsvps")
          .select("member_id")
          .eq("trip_id", input.tripId)
          .eq("response", "coming");
        if (attError) {
          return errorResponse(request, 500, "attendee_lookup_failed", requestId);
        }
        if (!attendees || attendees.length === 0) {
          return errorResponse(request, 400, "no_confirmed_attendees", requestId, "Cannot use dynamic split expense with no confirmed attendees.");
        }
      }
      rpcName = "phase5_manage_expense";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_action: input.action,
        p_expense_id: input.expenseId ?? null,
        p_expense_type: input.expenseType ?? "shared_receipt",
        p_payer_member_id: input.payerMemberId ?? null,
        p_amount_cents: input.amountCents ?? null,
        p_description: input.description ?? null,
        p_incurred_date: input.incurredDate ?? null,
        p_receipt_url: input.receiptUrl ?? null,
        p_source_reference_id: null,
        p_allocations: (input.allocations ?? []).map((a: any) => ({
          member_id: a.memberId ?? a.member_id,
          allocated_cents: a.allocatedCents ?? a.allocated_cents,
        })),
        p_actor_id: member.member_id,
        p_is_admin: member.member_role === "admin",
        p_split_mode: splitMode ?? null,
        p_receipt_storage_path: input.receiptStoragePath ?? null,
        p_receipt_file_name: input.receiptFileName ?? null,
        p_receipt_content_type: input.receiptContentType ?? null,
      };
      break;
    }
    case "admin_finalize_settlement": {
      const fin = await getTripFinancials(member, input.tripId as string);
      if (!fin.settlementRun) {
        return errorResponse(request, 400, "settlement_calculation_failed", requestId, "No expenses or balances found to finalize.");
      }

      // Materialize dynamic allocations for all_attendees expenses into trip_expense_allocations
      const expenses = (fin.expenses as any[]) ?? [];
      for (const exp of expenses) {
        if (exp.splitMode === "all_attendees") {
          await service.from("trip_expense_allocations").delete().eq("expense_id", exp.id);
          if (exp.allocations && exp.allocations.length > 0) {
            const allocRows = exp.allocations.map((a: any) => ({
              expense_id: exp.id,
              member_id: a.memberId,
              allocated_cents: a.allocatedCents,
            }));
            const { error: insertErr } = await service.from("trip_expense_allocations").insert(allocRows);
            if (insertErr) {
              console.error("Failed to materialize allocations for expense:", exp.id, insertErr);
              return errorResponse(request, 500, "allocation_materialization_failed", requestId);
            }
          }
        }
      }

      rpcName = "phase5_record_settlement_run";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_algorithm_used: (fin.settlementRun as any).algorithmUsed,
        p_total_expenses_cents: (fin.settlementRun as any).totalExpensesCents,
        p_snapshot_hash: `settle-${Date.now()}`,
        p_balances: (fin.balances as any[]).map((b: any) => ({
          member_id: b.memberId,
          total_paid_cents: b.totalPaidCents,
          total_allocated_cents: b.totalAllocatedCents,
          net_balance_cents: b.netBalanceCents,
        })),
        p_transfers: (fin.transfers as any[]).map((t: any) => ({
          payer_member_id: t.payerMemberId,
          recipient_member_id: t.recipientMemberId,
          amount_cents: t.amountCents,
          payment_method: t.paymentMethod,
        })),
        p_actor_id: member.member_id,
      };
      break;
    }
    case "update_settlement_transfer":
      rpcName = "phase5_update_transfer_status";
      rpcArgs = {
        p_transfer_id: input.transferId,
        p_action: input.action,
        p_payment_method: input.paymentMethod ?? null,
        p_notes: input.notes ?? null,
        p_actor_id: member.member_id,
        p_is_admin: member.member_role === "admin",
      };
      break;
    case "admin_sync_trip_commitments":
      rpcName = "seed_trip_commitments_from_master";
      rpcArgs = {
        p_trip_id: input.tripId,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_manage_master_activity":
      rpcName = "phase6_manage_master_activity";
      rpcArgs = {
        p_action: input.action,
        p_id: input.id ?? null,
        p_payload: {
          title: input.title ?? null,
          category: input.category ?? null,
          image_url: input.imageUrl ?? null,
          location_name: input.locationName ?? null,
          address: input.address ?? null,
          directions_url: input.directionsUrl ?? null,
          booking_url: input.bookingUrl ?? null,
          waiver_url: input.waiverUrl ?? null,
          unit_label: input.unitLabel ?? null,
          unit_capacity: input.unitCapacity ?? null,
          booking_notes: input.bookingNotes ?? null,
          is_active: input.isActive ?? null,
        },
        p_actor_id: member.member_id,
      };
      break;
    case "admin_manage_trip_activity":
      rpcName = "phase6_manage_trip_activity";
      rpcArgs = {
        p_action: input.action === "clone_from_master" ? "clone" : input.action,
        p_trip_id: input.tripId,
        p_activity_id: input.activityId ?? null,
        p_payload: {
          master_activity_id: input.masterActivityId ?? null,
          title: input.title ?? null,
          category: input.category ?? null,
          image_url: input.imageUrl ?? null,
          activity_date: input.activityDate ?? null,
          start_time: input.startTime ?? null,
          end_time: input.endTime ?? null,
          location_name: input.locationName ?? null,
          address: input.address ?? null,
          directions_url: input.directionsUrl ?? null,
          booking_url: input.bookingUrl ?? null,
          waiver_url: input.waiverUrl ?? null,
          unit_label: input.unitLabel ?? null,
          unit_capacity: input.unitCapacity ?? null,
          booking_notes: input.bookingNotes ?? null,
          opt_out_policy: input.optOutPolicy ?? null,
          group_count: input.groupCount ?? null,
          auto_initialize_groups: input.autoInitializeGroups ?? null,
          is_pairings_locked: input.isPairingsLocked ?? null,
        },
        p_actor_id: member.member_id,
      };
      break;
    case "set_activity_participation":
      rpcName = "phase6_set_activity_participation";
      rpcArgs = {
        p_activity_id: input.activityId,
        p_member_id: (member.member_role === "admin" && input.memberId) ? input.memberId : member.member_id,
        p_status: input.status,
        p_actor_id: member.member_id,
      };
      break;
    case "admin_manage_activity_pairings": {
      let pairingsAction = input.pairingsAction ?? input.action;
      let payload: Record<string, unknown> = {};

      if ((input.groups || input.assignments) && (!pairingsAction || pairingsAction === "set_pairings")) {
        pairingsAction = "set_pairings";
        const assignments: Array<{ group_id: string; member_id: string }> = [];
        if (input.assignments) {
          for (const a of (input.assignments as any[])) {
            const gId = a.groupId ?? a.group_id;
            const mId = a.memberId ?? a.member_id;
            if (gId && mId) assignments.push({ group_id: gId, member_id: mId });
          }
        }
        if (input.groups) {
          for (const g of (input.groups as any[])) {
            const gId = g.id ?? g.groupId ?? g.group_id;
            const members = g.memberIds ?? g.members ?? [];
            for (const mId of members) {
              if (gId && mId) assignments.push({ group_id: gId, member_id: mId });
            }
          }
        }
        payload = { assignments };
      } else if (!pairingsAction && input.lockPairings !== undefined) {
        pairingsAction = input.lockPairings ? "lock_pairings" : "unlock_pairings";
      } else {
        pairingsAction = pairingsAction ?? "auto_assign";
        payload = {
          group_id: input.groupId,
          member_id: input.memberId,
          group_number: input.groupNumber,
          group_name: input.groupName ?? input.groupLabel,
          group_label: input.groupLabel ?? input.groupName,
          ...(input.memberIds !== undefined ? { member_ids: input.memberIds } : {}),
        };
      }

      rpcName = "phase6_manage_activity_pairings";
      rpcArgs = {
        p_activity_id: input.activityId,
        p_action: pairingsAction,
        p_payload: payload,
        p_actor_id: member.member_id,
      };
      break;
    }
    case "submit_activity_voucher":
      rpcName = "phase6_submit_voucher";
      rpcArgs = {
        p_group_id: input.groupId,
        p_purchaser_member_id: input.purchasedByMemberId ?? input.purchaserMemberId ?? member.member_id,
        p_purchase_date: input.purchaseDate ?? new Date().toISOString().slice(0, 10),
        p_amount_cents: input.voucherCostCents ?? input.amountCents ?? null,
        p_order_ref: input.orderNumber ?? input.orderReferenceNumber ?? null,
        p_voucher_code: input.voucherCode ?? null,
        p_security_pin: input.securityPin ?? null,
        p_actor_id: member.member_id,
      };
      break;
    case "request_partner_swap": {
      let targetMemberId = input.targetMemberId;
      if (!targetMemberId && input.targetGroupId) {
        const { data: gm } = await service
          .from("trip_activity_group_members")
          .select("member_id")
          .eq("group_id", input.targetGroupId)
          .limit(1)
          .maybeSingle();
        if (gm?.member_id) targetMemberId = gm.member_id;
      }
      rpcName = "phase6_request_partner_swap";
      rpcArgs = {
        p_activity_id: input.activityId,
        p_requester_id: member.member_id,
        p_target_id: targetMemberId ?? null,
        p_actor_id: member.member_id,
      };
      break;
    }
    case "respond_partner_swap": {
      const swapActionMap: Record<string, string> = {
        accepted: "accept",
        accept: "accept",
        declined: "decline",
        decline: "decline",
        cancelled: "cancel",
        cancel: "cancel",
      };
      rpcName = "phase6_respond_partner_swap";
      rpcArgs = {
        p_request_id: input.swapRequestId ?? input.requestId,
        p_action: swapActionMap[(input.status as string)] || input.status,
        p_actor_id: member.member_id,
      };
      break;
    }
    case "record_activity_waiver_click":
      rpcName = "phase6_update_activity_waiver";
      rpcArgs = {
        p_activity_id: input.activityId,
        p_action: "click",
        p_actor_id: member.member_id,
      };
      break;
    case "confirm_activity_waiver_signed":
      rpcName = "phase6_update_activity_waiver";
      rpcArgs = {
        p_activity_id: input.activityId,
        p_action: "sign",
        p_actor_id: member.member_id,
      };
      break;
    default: return errorResponse(request, 400, "unsupported_operation", requestId);
  }

  const { data, error } = await service.rpc(rpcName, rpcArgs as never);
  if (error) {
    return errorResponse(
      request,
      databaseStatus(error.code),
      databaseStatus(error.code) === 500 ? "operation_failed" : "operation_rejected",
      requestId,
      error.message
    );
  }
  if ((action === "request_partner_swap" || action === "respond_partner_swap") && data && typeof data === "object") {
    (data as any).swap_request_id = (data as any).request_id;
    (data as any).swapRequestId = (data as any).request_id;
  }
  if (action === "admin_manage_activity_pairings" && data && typeof data === "object") {
    if ((data as any).group_id && !(data as any).groupId) {
      (data as any).groupId = (data as any).group_id;
    }
  }
  if (action === "admin_manage_trip_activity" && data && typeof data === "object") {
    if ((data as any).activity_id && !(data as any).activityId) {
      (data as any).activityId = (data as any).activity_id;
    }
  }
  if (action === "set_activity_participation" && input.notes !== undefined) {
    const targetMemberId = (member.member_role === "admin" && input.memberId) ? input.memberId : member.member_id;
    await service.from("trip_activity_participants").update({ notes: input.notes }).eq("activity_id", input.activityId).eq("member_id", targetMemberId);
  }
  if (action === "admin_manage_activity_pairings" && input.lockPairings !== undefined && (input.groups || input.assignments)) {
    await service.rpc("phase6_manage_activity_pairings", {
      p_activity_id: input.activityId,
      p_action: input.lockPairings ? "lock_pairings" : "unlock_pairings",
      p_actor_id: member.member_id,
    });
  }
  if (action === "admin_finalize_settlement") {
    try {
      await service.rpc("purge_expired_receipts");
    } catch (purgeErr) {
      console.error("purge_expired_receipts error in admin_finalize_settlement:", purgeErr);
    }
  }
  if (action === "verify_deposit") {
    if (input.status === "exempt") {
      await service.from("camping_trips").update({ cabin_payer_member_id: input.memberId }).eq("id", input.tripId);
      await service.from("cabin_reservations").update({ paid_by_member_id: input.memberId }).eq("trip_id", input.tripId);
    } else if (input.status === "unpaid") {
      await service.from("camping_trips").update({ cabin_payer_member_id: null }).eq("id", input.tripId).eq("cabin_payer_member_id", input.memberId);
      await service.from("cabin_reservations").update({ paid_by_member_id: null }).eq("trip_id", input.tripId).eq("paid_by_member_id", input.memberId);
    }
  }
  if (action === "admin_transition_trip_lifecycle") {
    if (input.toStatus === "completed" || input.toStatus === "financially_settled") {
      try {
        await service.rpc("purge_expired_receipts");
      } catch (purgeErr) {
        console.error("purge_expired_receipts error in admin_transition_trip_lifecycle:", purgeErr);
      }
    }
  }
  if (action === "admin_configure_trip") {
    if (typeof input.cabinCount !== "undefined" || typeof input.perCabinCapacity !== "undefined" || typeof input.cabinPayerMemberId !== "undefined") {
      const { error: updateError } = await service.from("camping_trips").update({
        ...(typeof input.cabinCount !== "undefined" && { cabin_count: input.cabinCount }),
        ...(typeof input.perCabinCapacity !== "undefined" && { per_cabin_capacity: input.perCabinCapacity }),
        ...(typeof input.cabinPayerMemberId !== "undefined" && { cabin_payer_member_id: input.cabinPayerMemberId }),
      }).eq("id", input.tripId);
      if (updateError) {
        return errorResponse(request, databaseStatus(updateError.code), "operation_failed", requestId);
      }
      if (typeof input.cabinPayerMemberId !== "undefined") {
        await service.from("cabin_reservations").update({
          paid_by_member_id: input.cabinPayerMemberId,
        }).eq("trip_id", input.tripId);
      }
    }
    const { error: seedErr } = await service.rpc("seed_trip_commitments_from_master", {
      p_trip_id: input.tripId,
      p_actor_id: member.member_id,
    });
    if (seedErr) {
      console.error("seed_trip_commitments_from_master error in admin_configure_trip:", seedErr);
    }
  }
  if (action === "admin_create_custom_trip") {
    const createdTripId = (data as any)?.tripId ?? (data as any)?.trip_id ?? (data as any)?.id;
    if (createdTripId) {
      const { error: seedErr } = await service.rpc("seed_trip_commitments_from_master", {
        p_trip_id: createdTripId,
        p_actor_id: member.member_id,
      });
      if (seedErr) {
        console.error("seed_trip_commitments_from_master error in admin_create_custom_trip:", seedErr);
      }
    }
  }
  if ((action === "manage_trip_commitments" || action === "manage_trip_commitment") && input.action === "admin_create") {
    const createdCommitmentId = (data as any)?.commitment_id ?? (data as any)?.id;
    if (createdCommitmentId && (input.commitmentType || typeof input.isActive === "boolean")) {
      const { error: patchError } = await service.from("trip_commitments").update({
        ...(input.commitmentType && { commitment_type: input.commitmentType }),
        ...(typeof input.isActive === "boolean" && { is_active: input.isActive }),
      }).eq("id", createdCommitmentId);
      if (patchError) {
        console.error("Failed to update commitment_type / is_active on admin_create:", patchError);
      } else if (data && typeof data === "object") {
        if (input.commitmentType) (data as any).commitment_type = input.commitmentType;
        if (typeof input.isActive === "boolean") (data as any).is_active = input.isActive;
      }
    }
  }
  if ((action === "manage_trip_commitments" || action === "manage_trip_commitment") && input.action === "admin_update") {
    const commitmentId = input.commitmentId ?? (data as any)?.commitment_id;
    if (commitmentId && (input.commitmentType || typeof input.isActive === "boolean")) {
      const { error: patchError } = await service.from("trip_commitments").update({
        ...(input.commitmentType && { commitment_type: input.commitmentType }),
        ...(typeof input.isActive === "boolean" && { is_active: input.isActive }),
      }).eq("id", commitmentId);
      if (patchError) {
        console.error("Failed to update commitment_type / is_active on admin_update:", patchError);
      } else if (data && typeof data === "object") {
        if (input.commitmentType) (data as any).commitment_type = input.commitmentType;
        if (typeof input.isActive === "boolean") (data as any).is_active = input.isActive;
      }
    }
  }
  try {
    await finish(authUser.id, action, aggregate, key, input, resultId(data));
  } catch {
    return errorResponse(request, 500, "idempotency_completion_failed", requestId);
  }
  return json(request, 200, { ...(data && typeof data === "object" ? data as Record<string, unknown> : { result: data }), requestId });
});
