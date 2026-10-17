import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveServiceApiKey } from "../_shared/service-key.mjs";
import { canonicalJson, keyedDigest, requestDigest, requiredEnv } from "../_shared/crypto.ts";
import { corsHeaders, isOriginAllowed, json, readBody } from "../_shared/http.ts";

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
  admin_set_daily_workload_target: z.object({ tripId: uuid, target: z.number().min(0.5).max(100).multipleOf(0.5).nullable(), expectedVersion: z.number().int().positive() }).strict(),
  get_calendar: z.object({}).strict(),
  get_constitution: z.object({ tripId: uuid.optional() }).strict(),
  get_trip_details: z.object({ tripId: uuid }).strict(),
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
};

type Member = { member_id: string; auth_user_id: string; member_role: "member" | "admin"; account_status: "active" | "inactive" | "suspended" };
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
  for (const key of ["tripId", "campsiteId", "memberId", "slotId", "timeSlotId", "slotDutyId", "assignmentId"]) if (typeof input[key] === "string") return input[key] as string;
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
  for (const key of ["rsvpId", "tripId", "ruleVersionId", "overrideId", "campsiteId", "invitationId"]) {
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
    service.from("camping_trips").select("id,month_key,rotation_position,suggested_campsite_id,selected_campsite_id,starts_on,ends_on,club_timezone_snapshot,poll_deadline_at,minimum_participants,minimum_basis,max_capacity,per_cabin_capacity,cabin_count,poll_status,additional_information,cabin_booking_status,cabin_availability_status,title,event_status,camping_type,task_quota_target,daily_workload_target,deleted_at,version").is("deleted_at", null).gte("month_key", month).order("month_key"),
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
    service.from("trip_rsvps").select("trip_id,member_id,response,rule_acknowledgment_id,version,updated_at").in("trip_id", tripIds),
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

async function getTripDetails(member: Member, tripId: string): Promise<Record<string, unknown>> {
  const tripResult = await service.from("camping_trips")
    .select("id,month_key,rotation_position,suggested_campsite_id,selected_campsite_id,starts_on,ends_on,club_timezone_snapshot,poll_deadline_at,minimum_participants,minimum_basis,max_capacity,per_cabin_capacity,cabin_count,poll_status,additional_information,cabin_booking_status,title,event_status,trip_status,camping_type,task_quota_target,daily_workload_target,trip_mileage_rate_cents,deposit_amount_cents,deleted_at,version")
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

  const [campsiteResult, bundleResult, rsvpResult, waitlistResult, dutiesResult, cabinReservationResult] = await Promise.all([
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
      .select("trip_id,member_id,response,rule_acknowledgment_id,version,updated_at")
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
      .maybeSingle()
      .catch(() => ({ data: null, error: null })),
  ]);
  checkError(campsiteResult.error);
  checkError(bundleResult.error);
  checkError(rsvpResult.error);
  checkError(waitlistResult.error);
  checkError(dutiesResult.error);

  const campsite = campsiteResult.data;
  const rsvps = rsvpResult.data ?? [];
  const waitlist = waitlistResult.data ?? [];
  const memberIds = [...new Set([...rsvps.map((r) => r.member_id), ...waitlist.map((w) => w.member_id)])];
  const { data: memberRows, error: memberRowsError } = memberIds.length
    ? await service.from("member_profiles").select("member_id,display_name").in("member_id", memberIds).eq("account_status", "active")
    : { data: [], error: null };
  checkError(memberRowsError);
  const nameMap = new Map((memberRows ?? []).map((m) => [m.member_id, m.display_name]));

  const ownRsvp = rsvps.find((r) => r.member_id === member.member_id);
  const comingCount = rsvps.filter((r) => r.response === "coming").length;

  const participantEntries = rsvps
    .filter((r) => r.response === "coming")
    .map((r) => ({
      memberId: r.member_id,
      displayName: nameMap.get(r.member_id) ?? "Member",
      response: r.response,
    }));

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
      acknowledgmentId: ownRsvp.rule_acknowledgment_id,
      version: ownRsvp.version,
      updatedAt: ownRsvp.updated_at,
      acceptedRuleBundle,
    } : null,
    participantEntries,
    waitlistEntries,
    allMemberEntries,
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
  if (adminActions.has(action) && member.member_role !== "admin") return errorResponse(request, 403, "administrator_required", requestId);
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
      const err = error as { message?: string; code?: string; status?: number } | null;
      if (err?.message === "trip not found" || err?.code === "22023" || err?.status === 404) {
        return errorResponse(request, 404, "trip_not_found", requestId);
      }
      return errorResponse(request, 500, "trip_details_read_failed", requestId);
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
      const [slotsResult, assignmentsResult, creditsResult, quotaResult, attendeesResult, dailyResult] = await Promise.all([
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
            member:member_profiles!member_id(
              member_id,
              display_name
            )
          `)
          .eq("trip_id", tripId)
          .eq("response", "coming"),
        service.rpc("phase3_get_daily_workload_progress", { p_trip_id: tripId, p_member_id: member.member_id }),
      ]);

      checkError(dailyResult.error);
      checkError(slotsResult.error);
      checkError(assignmentsResult.error);
      checkError(creditsResult.error);
      checkError(quotaResult.error);
      checkError(attendeesResult.error);

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
        requestId,
      });
    } catch {
      return errorResponse(request, 500, "trip_task_matrix_read_failed", requestId);
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
  if (action === "admin_configure_trip" && (typeof input.cabinCount !== "undefined" || typeof input.perCabinCapacity !== "undefined")) {
    const { error: updateError } = await service.from("camping_trips").update({
      ...(typeof input.cabinCount !== "undefined" && { cabin_count: input.cabinCount }),
      ...(typeof input.perCabinCapacity !== "undefined" && { per_cabin_capacity: input.perCabinCapacity }),
    }).eq("id", input.tripId);
    if (updateError) {
      return errorResponse(request, databaseStatus(updateError.code), "operation_failed", requestId);
    }
  }
  try {
    await finish(authUser.id, action, aggregate, key, input, resultId(data));
  } catch {
    return errorResponse(request, 500, "idempotency_completion_failed", requestId);
  }
  return json(request, 200, { ...(data && typeof data === "object" ? data as Record<string, unknown> : { result: data }), requestId });
});
