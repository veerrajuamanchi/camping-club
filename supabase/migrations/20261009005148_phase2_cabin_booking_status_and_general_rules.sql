-- Phase 2 remediation: distinguish booking outcomes from availability research
-- and restore the general rules already provided by the club owner.

alter table public.camping_trips
  add column cabin_booking_status text,
  add constraint camping_trips_cabin_booking_status_check
    check (cabin_booking_status is null or cabin_booking_status in ('booked','no_vacancy','sites_available'));

-- Map only unambiguous legacy values. Preserve every source value in the old
-- column; limited/unknown/manual-confirmation values need an administrator's
-- explicit choice and are intentionally left null in the new projection.
update public.camping_trips
set cabin_booking_status = case cabin_availability_status
  when 'available' then 'sites_available'
  when 'unavailable' then 'no_vacancy'
  else null
end;

comment on column public.camping_trips.cabin_availability_status is
  'Legacy Phase 2 availability field retained for migration history; use cabin_booking_status for current booking state.';
comment on column public.camping_trips.cabin_booking_status is
  'Current administrator-entered booking status: booked, no_vacancy, or sites_available. Null requires administrator review.';

drop function public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid);

create function public.phase2_admin_configure_trip(
  p_actor_id uuid,p_trip_id uuid,p_starts_on date,p_ends_on date,p_deadline_date date,p_deadline_time time,
  p_minimum_participants integer,p_max_capacity integer,p_selected_campsite_id uuid,p_cabin_booking_status text,
  p_additional_information text,p_expected_version integer,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_trip public.camping_trips%rowtype; v_config public.club_configuration%rowtype; v_deadline_date date; v_deadline_time time; v_deadline timestamptz; v_trip_timezone text; v_old_site uuid; v_old_booking_status text;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on or p_minimum_participants not between 1 and 100
    or (p_max_capacity is not null and p_max_capacity<p_minimum_participants)
    or p_cabin_booking_status not in ('booked','no_vacancy','sites_available')
    or p_reason is null or length(btrim(p_reason))=0 or p_request_id is null then raise exception 'invalid trip configuration'; end if;
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found then raise exception 'poll not found'; end if;
  if v_trip.version<>p_expected_version then raise exception 'stale poll version' using errcode='40001'; end if;
  select * into v_config from public.club_configuration where singleton for share;
  v_trip_timezone:=coalesce(v_trip.club_timezone_snapshot,v_config.club_timezone);
  if v_trip_timezone is null then raise exception 'configure the club timezone before setting poll dates'; end if;
  if not exists(select 1 from public.campsites where id=p_selected_campsite_id and active) then raise exception 'selected campsite must be active'; end if;
  v_deadline_date:=coalesce(p_deadline_date,p_starts_on-v_config.default_poll_lead_days);
  v_deadline_time:=coalesce(p_deadline_time,v_config.default_poll_close_time);
  if v_deadline_time is not null then v_deadline:=(v_deadline_date+v_deadline_time) at time zone v_trip_timezone; else v_deadline:=null; end if;
  if v_deadline is not null and v_deadline>=(p_starts_on::timestamp at time zone v_trip_timezone) then raise exception 'poll deadline must be before trip start'; end if;
  if v_trip.poll_status='open' and v_deadline is not null and v_deadline<=now() then raise exception 'an open poll needs a future deadline'; end if;
  v_old_site:=v_trip.selected_campsite_id; v_old_booking_status:=v_trip.cabin_booking_status;
  update public.camping_trips set starts_on=p_starts_on,ends_on=p_ends_on,club_timezone_snapshot=v_trip_timezone,
    poll_deadline_at=v_deadline,minimum_participants=p_minimum_participants,max_capacity=p_max_capacity,
    selected_campsite_id=p_selected_campsite_id,cabin_booking_status=p_cabin_booking_status,
    additional_information=coalesce(p_additional_information,''),updated_by=p_actor_id,updated_at=now(),version=version+1
    where id=p_trip_id returning * into v_trip;
  if p_selected_campsite_id<>v_old_site then
    insert into public.trip_poll_events(trip_id,actor_id,event_type,request_id,reason,event_details)
      values(p_trip_id,p_actor_id,'campsite_overridden',p_request_id,p_reason,jsonb_build_object('suggested_campsite_id',v_trip.suggested_campsite_id,'selected_campsite_id',p_selected_campsite_id));
  end if;
  insert into public.trip_poll_events(trip_id,actor_id,event_type,request_id,reason,event_details)
    values(p_trip_id,p_actor_id,'trip_configured',p_request_id,p_reason,jsonb_build_object('starts_on',p_starts_on,'ends_on',p_ends_on,'poll_deadline_at',v_deadline,'minimum_participants',p_minimum_participants,'previous_cabin_booking_status',v_old_booking_status,'cabin_booking_status',v_trip.cabin_booking_status,'version',v_trip.version));
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','camping_trip',p_trip_id,'interest_poll_configured',p_reason,p_request_id,extensions.digest(convert_to(to_jsonb(v_trip)::text,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
  return jsonb_build_object('tripId',p_trip_id,'version',v_trip.version,'pollDeadlineAt',v_deadline,'minimumBasis',null);
end $$;

revoke all on function public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid) to service_role;

with seed_rules(stable_key,category,human_text) as (values
  ('driver-mileage','transport','A driver is reimbursed $0.76 per mile when the carpool carries at least three people, including the driver.'),
  ('car-wash-contribution','expenses','Each participant contributes $5 toward the car wash.'),
  ('van-arrangements','transport','For a group of four, use one van. For five, use one van when feasible; an exception may be used when one van is not feasible. For groups up to eight, aim to use two vans; a third van is an exception.'),
  ('food-budget-target','meals','For a Friday-to-Sunday trip, target no more than $50 per person for shared food and non-alcoholic drinks (for example, $200 for four people). Buy shared food up front within the group target. This is a planning target, not an automatic spending cap.'),
  ('travel-budget-target','transport','Target no more than $50 per person for travel expenses. The $5 per-person car-wash contribution is included in the travel budget target.'),
  ('cabin-budget-target','cabin','Target no more than $60 per person for cabin expenses. This is a planning target, not an automatic spending cap.'),
  ('cabin-contribution','cabin','Each attendee is responsible for a $50 contribution toward the cabin, paid to the administrator-assigned cabin payer. The trip notice will state the due timing under the approved participation policy. A confirmed attendee’s obligation remains after withdrawal; member-withdrawal contributions are non-refundable.'),
  ('group-expense-approval','expenses','Do not charge purchases under the group name without administrator approval. Members may make optional purchases individually; document those expenses and split them only with the people involved.'),
  ('alcohol-cost-sharing','expenses','Members should bring their own alcohol or coordinate purchases with interested people. Alcohol is not charged to the group, and a member who does not drink is never charged for it, even if most of the group participates.'),
  ('floor-lottery','lodging','If there are not enough beds for everyone, use a random draw to select the required number of people to sleep on the floor. A selected person may exchange with someone who agrees to swap.'),
  ('responsibility-workload','custom','Responsibilities include cutting vegetables, cleaning meat, cabin-floor cleaning, bathroom cleaning, dishes, main dish, side dish, curry, making drinks, and activity planning; administrators may add trip-specific tasks. Members choose available responsibilities first-come, first-served during signup; later signups choose from the remaining work. Driving counts toward workload, so drivers should be assigned to members with no or fewer other responsibilities.'),
  ('responsibility-time-blocks','custom','Plan responsibility assignments for Friday night, Saturday morning, Saturday night, and Sunday morning. Sunday morning includes cleanup and leaving the cabin tidy.'),
  ('packing-checklist','custom','Common packing items: pillow, blanket, water shorts, swimming goggles, towel, two or three changes of clothes, toothbrush, toothpaste, optional sleeping bag, shoes, sandals, and sunglasses. Administrators may add trip-specific items.'),
  ('coffee-tea-preferences','meals','Collect each participant’s coffee or tea preference separately for Saturday morning and Sunday morning.'),
  ('meal-preferences','meals','Collect vegetarian or non-vegetarian preferences for the whole trip or each planned meal. Participants may indicate that they are not eating a particular meal.')
)
insert into public.rule_definitions(stable_key,category,scope)
select s.stable_key,s.category,'general' from seed_rules s
where not exists(select 1 from public.rule_definitions d where d.scope='general' and d.stable_key=s.stable_key);

with seed_rules(stable_key,category,human_text) as (values
  ('driver-mileage','transport','A driver is reimbursed $0.76 per mile when the carpool carries at least three people, including the driver.'),
  ('car-wash-contribution','expenses','Each participant contributes $5 toward the car wash.'),
  ('van-arrangements','transport','For a group of four, use one van. For five, use one van when feasible; an exception may be used when one van is not feasible. For groups up to eight, aim to use two vans; a third van is an exception.'),
  ('food-budget-target','meals','For a Friday-to-Sunday trip, target no more than $50 per person for shared food and non-alcoholic drinks (for example, $200 for four people). Buy shared food up front within the group target. This is a planning target, not an automatic spending cap.'),
  ('travel-budget-target','transport','Target no more than $50 per person for travel expenses. The $5 per-person car-wash contribution is included in the travel budget target.'),
  ('cabin-budget-target','cabin','Target no more than $60 per person for cabin expenses. This is a planning target, not an automatic spending cap.'),
  ('cabin-contribution','cabin','Each attendee is responsible for a $50 contribution toward the cabin, paid to the administrator-assigned cabin payer. The trip notice will state the due timing under the approved participation policy. A confirmed attendee’s obligation remains after withdrawal; member-withdrawal contributions are non-refundable.'),
  ('group-expense-approval','expenses','Do not charge purchases under the group name without administrator approval. Members may make optional purchases individually; document those expenses and split them only with the people involved.'),
  ('alcohol-cost-sharing','expenses','Members should bring their own alcohol or coordinate purchases with interested people. Alcohol is not charged to the group, and a member who does not drink is never charged for it, even if most of the group participates.'),
  ('floor-lottery','lodging','If there are not enough beds for everyone, use a random draw to select the required number of people to sleep on the floor. A selected person may exchange with someone who agrees to swap.'),
  ('responsibility-workload','custom','Responsibilities include cutting vegetables, cleaning meat, cabin-floor cleaning, bathroom cleaning, dishes, main dish, side dish, curry, making drinks, and activity planning; administrators may add trip-specific tasks. Members choose available responsibilities first-come, first-served during signup; later signups choose from the remaining work. Driving counts toward workload, so drivers should be assigned to members with no or fewer other responsibilities.'),
  ('responsibility-time-blocks','custom','Plan responsibility assignments for Friday night, Saturday morning, Saturday night, and Sunday morning. Sunday morning includes cleanup and leaving the cabin tidy.'),
  ('packing-checklist','custom','Common packing items: pillow, blanket, water shorts, swimming goggles, towel, two or three changes of clothes, toothbrush, toothpaste, optional sleeping bag, shoes, sandals, and sunglasses. Administrators may add trip-specific items.'),
  ('coffee-tea-preferences','meals','Collect each participant’s coffee or tea preference separately for Saturday morning and Sunday morning.'),
  ('meal-preferences','meals','Collect vegetarian or non-vegetarian preferences for the whole trip or each planned meal. Participants may indicate that they are not eating a particular meal.')
)
insert into public.rule_versions(definition_id,version_no,human_text,structured_values,effective_from)
select d.id,1,s.human_text,'{}'::jsonb,now()
from seed_rules s join public.rule_definitions d on d.scope='general' and d.stable_key=s.stable_key
where not exists(select 1 from public.rule_versions v where v.definition_id=d.id and v.version_no=1);
