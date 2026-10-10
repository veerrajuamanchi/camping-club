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
  "get_calendar", "get_constitution", "get_trip_details", "admin_configure_club", "admin_generate_calendar",
  "admin_reorder_campsites", "admin_update_campsite", "admin_create_campsite", "admin_configure_trip", "admin_set_poll_status",
  "admin_publish_rule", "admin_set_rule_override", "submit_rsvp", "admin_record_interest", "request_withdrawal",
  "admin_promote_from_waitlist",
] as const;
const requestSchema = z.object({ action: z.enum(actionNames), input: z.unknown().optional() }).strict();

const inputSchemas = {
  get_calendar: z.object({}).strict(),
  get_constitution: z.object({ tripId: uuid.optional() }).strict(),
  get_trip_details: z.object({ tripId: uuid }).strict(),
  admin_configure_club: z.object({
    timezone: z.string().trim().min(1).max(100), leadDays: z.number().int().min(1).max(120), closeTime: time.nullable(),
    defaultMinimumParticipants: z.number().int().min(1).max(100), nextRotationPosition: z.number().int().min(1), expectedVersion: z.number().int().positive(),
  }).strict(),
  admin_generate_calendar: z.object({ throughMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
  admin_reorder_campsites: z.object({ order: z.array(uuid).min(7), nextRotationPosition: z.number().int().min(1), reason }).strict(),
  admin_create_campsite: z.object({
    name: z.string().trim().min(1).max(120),
    availabilityUrl: z.string().url().startsWith("https://").nullable().optional(),
    locationDescription: z.string().max(2000),
    directions: z.string().max(4000).nullable().optional(),
    cabinCapacity: z.number().int().positive().nullable().optional(),
    cabinTypes: z.array(z.string().trim().min(1).max(100)).max(20).optional().default([]),
    reservationInstructions: z.string().max(4000).nullable().optional(),
    estimatedRateCents: z.number().int().nonnegative().nullable().optional(),
    availabilityStatus: z.enum(["available", "limited", "unavailable", "unknown", "manual_confirmation"]).optional().default("available"),
    availabilitySourceUrl: z.string().url().nullable().optional(),
    imageUrl: z.string().url().nullable().optional(),
    campHostName: z.string().trim().max(120).nullable().optional(),
    campHostPhone: z.string().trim().max(40).nullable().optional(),
    campFeatures: z.array(z.string().trim().min(1).max(100)).max(30).optional().default([]),
    cabinInformation: z.string().max(4000).nullable().optional(),
    adminNotes: z.string().max(4000).optional().default(""),
    reason,
  }).strict(),
  admin_update_campsite: z.object({
    campsiteId: uuid, expectedVersion: z.number().int().positive(), name: z.string().trim().min(1).max(120),
    availabilityUrl: z.string().url().startsWith("https://").nullable(), locationDescription: z.string().max(2000),
    directions: z.string().max(4000).nullable(), cabinCapacity: z.number().int().positive().nullable(),
    cabinTypes: z.array(z.string().trim().min(1).max(100)).max(20), reservationInstructions: z.string().max(4000).nullable(),
    estimatedRateCents: z.number().int().nonnegative().nullable(),
    availabilityStatus: z.enum(["available", "limited", "unavailable", "unknown", "manual_confirmation"]),
    availabilitySourceUrl: z.string().url().nullable(), availabilityVerifiedAt: z.string().datetime().nullable(),
    imageUrl: z.string().url().nullable().optional(),
    campHostName: z.string().trim().max(120).nullable().optional(),
    campHostPhone: z.string().trim().max(40).nullable().optional(),
    campFeatures: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    cabinInformation: z.string().max(4000).nullable().optional(),
    adminNotes: z.string().max(4000), reason,
  }).strict(),
  admin_configure_trip: z.object({
    tripId: uuid, startsOn: date, endsOn: date, deadlineDate: date.nullable(), deadlineTime: time.nullable(),
    minimumParticipants: z.number().int().min(1).max(100), maxCapacity: z.number().int().min(1).max(100).nullable(),
    cabinCount: z.number().int().min(1).max(50).nullable().optional(),
    perCabinCapacity: z.number().int().min(1).max(50).optional(),
    selectedCampsiteId: uuid, cabinBookingStatus: z.enum(["booked", "no_vacancy", "sites_available"]),
    additionalInformation: z.string().max(4000), expectedVersion: z.number().int().positive(), reason,
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
};

type Member = { member_id: string; auth_user_id: string; member_role: "member" | "admin"; account_status: "active" | "inactive" | "suspended" };
type IdempotencyClaim = { state: "started" | "in_progress" | "replay"; resultId?: string; resultCode?: string };
type Action = typeof actionNames[number];

const adminActions = new Set<Action>([
  "admin_configure_club", "admin_generate_calendar", "admin_reorder_campsites", "admin_update_campsite", "admin_create_campsite",
  "admin_configure_trip", "admin_set_poll_status", "admin_publish_rule", "admin_set_rule_override", "admin_record_interest",
  "admin_promote_from_waitlist",
]);
const mutatingActions = new Set<Action>([
  "admin_configure_club", "admin_generate_calendar", "admin_reorder_campsites", "admin_update_campsite", "admin_create_campsite",
  "admin_configure_trip", "admin_set_poll_status", "admin_publish_rule", "admin_set_rule_override",
  "submit_rsvp", "admin_record_interest", "request_withdrawal", "admin_promote_from_waitlist",
]);

function errorResponse(request: Request, status: number, code: string, requestId: string): Response {
  return json(request, status, { error: code, requestId });
}

function databaseStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "40001" || code === "23505") return 409;
  if (code === "22023" || code === "22P02" || code === "23514" || code === "P0001") return 400;
  return 500;
}

function aggregateId(action: Action, input: Record<string, unknown>, memberId: string): string {
  for (const key of ["tripId", "campsiteId", "memberId"]) if (typeof input[key] === "string") return input[key] as string;
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
    service.from("campsites").select("id,rotation_position,name,availability_url,location_description,directions,cabin_capacity,cabin_types,reservation_instructions,estimated_rate_cents,availability_status,availability_source_url,availability_verified_at,image_url,camp_host_name,camp_host_phone,camp_features,cabin_information,active,version").eq("active", true).order("rotation_position"),
    service.from("camping_trips").select("id,month_key,rotation_position,suggested_campsite_id,selected_campsite_id,starts_on,ends_on,club_timezone_snapshot,poll_deadline_at,minimum_participants,minimum_basis,max_capacity,per_cabin_capacity,cabin_count,poll_status,additional_information,cabin_booking_status,cabin_availability_status,version").gte("month_key", month).order("month_key").limit(12),
  ]);
  checkError(configuration.error); checkError(campsiteResult.error); checkError(tripResult.error);
  const trips = tripResult.data ?? [];
  const tripIds = trips.map((trip) => trip.id);
  const openTripIds = trips.filter((trip) => trip.poll_status === "open").map((trip) => trip.id);
  if (openTripIds.length) {
    const { error } = await service.rpc("phase2_refresh_open_rule_bundles", { p_actor_id: member.member_id, p_trip_ids: openTripIds });
    checkError(error);
  }
  const [bundleResult, rsvpResult] = tripIds.length ? await Promise.all([
    service.from("trip_rule_bundles").select("id,trip_id,version_no,content_hash,rendered_bundle,created_at").in("trip_id", tripIds).eq("is_current", true),
    service.from("trip_rsvps").select("trip_id,member_id,response,rule_acknowledgment_id,version,updated_at").in("trip_id", tripIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  checkError(bundleResult.error); checkError(rsvpResult.error);
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
    .select("id,month_key,rotation_position,suggested_campsite_id,selected_campsite_id,starts_on,ends_on,club_timezone_snapshot,poll_deadline_at,minimum_participants,minimum_basis,max_capacity,per_cabin_capacity,cabin_count,poll_status,additional_information,cabin_booking_status,version")
    .eq("id", tripId)
    .maybeSingle();
  if (tripResult.error && tripResult.error.code !== "PGRST116") {
    checkError(tripResult.error);
  }
  if (!tripResult.data) {
    throw Object.assign(new Error("trip not found"), { code: "22023", status: 404 });
  }
  const trip = tripResult.data;

  if (trip.poll_status === "open") {
    const { error: refreshError } = await service.rpc("phase2_refresh_open_rule_bundles", {
      p_actor_id: member.member_id,
      p_trip_ids: [tripId],
    });
    checkError(refreshError);
  }

  const [campsiteResult, bundleResult, rsvpResult, waitlistResult] = await Promise.all([
    trip.selected_campsite_id
      ? service.from("campsites")
          .select("id,rotation_position,name,availability_url,location_description,directions,cabin_capacity,cabin_types,reservation_instructions,estimated_rate_cents,availability_status,availability_source_url,availability_verified_at,image_url,camp_host_name,camp_host_phone,camp_features,cabin_information,version")
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
  ]);
  checkError(campsiteResult.error);
  checkError(bundleResult.error);
  checkError(rsvpResult.error);
  checkError(waitlistResult.error);

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

  const effectiveCapacity = trip.max_capacity
    ?? (trip.cabin_count != null ? trip.cabin_count * (trip.per_cabin_capacity ?? 6) : null);

  return {
    tripId: trip.id,
    monthKey: String(trip.month_key).slice(0, 7),
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
    additionalInformation: trip.additional_information,
    version: trip.version,
    campsite: campsite ? {
      campsiteId: campsite.id,
      name: campsite.name,
      locationDescription: campsite.location_description,
      availabilityUrl: campsite.availability_url,
      directions: campsite.directions,
      cabinCapacity: campsite.cabin_capacity,
      reservationInstructions: campsite.reservation_instructions,
      imageUrl: campsite.image_url,
      campHostName: campsite.camp_host_name,
      campHostPhone: campsite.camp_host_phone,
      campFeatures: campsite.camp_features ?? [],
      cabinInformation: campsite.cabin_information,
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
  try { input = inputSchemas[action].parse(parsed.input ?? {}) as Record<string, unknown>; }
  catch { return errorResponse(request, 400, "invalid_request", requestId); }

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
    case "admin_configure_trip":
      rpcName = "phase2_admin_configure_trip";
      rpcArgs = { p_actor_id: member.member_id, p_trip_id: input.tripId, p_starts_on: input.startsOn, p_ends_on: input.endsOn, p_deadline_date: input.deadlineDate, p_deadline_time: input.deadlineTime, p_minimum_participants: input.minimumParticipants, p_max_capacity: input.maxCapacity, p_selected_campsite_id: input.selectedCampsiteId, p_cabin_booking_status: input.cabinBookingStatus, p_additional_information: input.additionalInformation, p_expected_version: input.expectedVersion, p_reason: input.reason, p_request_id: key };
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
    default: return errorResponse(request, 400, "unsupported_operation", requestId);
  }

  const { data, error } = await service.rpc(rpcName, rpcArgs as never);
  if (error) {
    return errorResponse(request, databaseStatus(error.code), databaseStatus(error.code) === 500 ? "operation_failed" : "operation_rejected", requestId);
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
