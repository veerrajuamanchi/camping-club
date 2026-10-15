-- Migration: Deactivate member auto-removes from upcoming events, and allow changing RSVP before or after confirmation

-- 1. Update phase1_update_membership to remove deactivated/suspended members from upcoming trips
create or replace function public.phase1_update_membership(p_actor_id uuid, p_target_member_id uuid, p_role text, p_status text, p_reason text, p_request_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_old_role text;
  v_old_status text;
  v_upcoming_trip_id uuid;
  v_rsvp public.trip_rsvps%rowtype;
begin
  if not exists(select 1 from public.member_profiles where member_id=p_actor_id and member_role='admin' and account_status='active') then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_role not in ('member','admin') or p_status not in ('active','inactive','suspended') then
    raise exception 'invalid membership state';
  end if;
  if p_reason is null or length(btrim(p_reason))=0 then
    raise exception 'a reason is required';
  end if;
  select member_role, account_status into v_old_role,v_old_status from public.member_profiles where member_id=p_target_member_id for update;
  if not found then
    raise exception 'member not found';
  end if;
  if v_old_role='admin' and v_old_status='active' and (p_role <> 'admin' or p_status <> 'active') and
     (select count(*) from public.member_profiles where member_role='admin' and account_status='active') <= 1 then
    raise exception 'cannot deactivate the last active administrator';
  end if;

  update public.member_profiles
  set member_role=p_role,
      account_status=p_status,
      deactivated_at=case when p_status='inactive' then coalesce(deactivated_at,now()) else null end
  where member_id=p_target_member_id;

  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id)
    values(p_actor_id,'admin','member',p_target_member_id,'membership_changed',p_reason,p_request_id)
    on conflict(actor_id,request_id) do nothing;

  -- If deactivated or suspended, automatically remove member from all upcoming camping trips
  if p_status in ('inactive', 'suspended') then
    for v_upcoming_trip_id in
      select ct.id from public.camping_trips ct
      where ct.deleted_at is null
        and coalesce(ct.ends_on, ct.starts_on, ct.month_key) >= (now() at time zone coalesce(ct.club_timezone_snapshot,'America/Los_Angeles'))::date order by ct.id for update
    loop
      -- If member was Going, change response to not_coming and audit the event
      select * into v_rsvp from public.trip_rsvps where trip_id = v_upcoming_trip_id and member_id = p_target_member_id for update;
      if found and v_rsvp.response = 'coming' then
        update public.trip_rsvps set response = 'not_coming', version = version + 1, updated_at = now() where id = v_rsvp.id;
        insert into public.trip_rsvp_events(trip_id, member_id, actor_id, event_type, from_response, to_response, rule_acknowledgment_id, request_id, reason)
          values(v_upcoming_trip_id, p_target_member_id, p_actor_id, 'changed', 'coming', 'not_coming', v_rsvp.rule_acknowledgment_id, gen_random_uuid(), 'Member account deactivated by administrator');
      end if;

      -- Drop any claimed duties
      update public.trip_duty_assignments
      set status = 'dropped', released_at = now(), released_by = p_actor_id, release_reason = 'Member account deactivated by administrator', updated_at = now()
      where trip_id = v_upcoming_trip_id and member_id = p_target_member_id and status in ('claimed', 'assigned_by_admin');

      -- Remove from waitlist if applicable
      update public.trip_waitlist_entries
      set status = 'removed', resolved_at = now()
      where trip_id = v_upcoming_trip_id and member_id = p_target_member_id and status = 'waiting';
    end loop;
  end if;
end $$;

-- 2. Update phase2_submit_rsvp to allow RSVP changes before or after confirmation (as long as event has not ended)
create or replace function public.phase2_submit_rsvp(
  p_auth_user_id uuid,p_trip_id uuid,p_response text,p_bundle_id uuid,p_content_hash text,p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  v_member uuid;
  v_trip public.camping_trips%rowtype;
  v_old public.trip_rsvps%rowtype;
  v_ack uuid;
  v_current_bundle public.trip_rule_bundles%rowtype;
  v_id uuid;
  v_version integer;
  v_event text;
  v_existing boolean;
begin
  if p_auth_user_id is null or p_response not in ('coming','not_coming') or p_request_id is null then
    raise exception 'invalid RSVP';
  end if;
  select member_id into v_member from public.member_profiles where auth_user_id=p_auth_user_id and account_status='active' and member_role in ('member','admin');
  if not found then
    raise exception 'active member required' using errcode='42501';
  end if;
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found then
    raise exception 'poll not found';
  end if;
  if v_trip.deleted_at is not null or v_trip.event_status='cancelled' or v_trip.poll_status='draft' or v_trip.ends_on is null or v_trip.ends_on < (now() at time zone coalesce(v_trip.club_timezone_snapshot,'America/Los_Angeles'))::date then
    raise exception 'camping event is closed';
  end if;
  if p_response='coming' and (not exists(select 1 from public.trip_rsvps where trip_id=p_trip_id and member_id=v_member and response='coming')) then
    perform private.phase2_build_rule_bundle(p_trip_id,v_member);
  end if;
  select * into v_old from public.trip_rsvps where trip_id=p_trip_id and member_id=v_member for update;
  v_existing:=found;
  if v_existing then
    if p_expected_version is null or p_expected_version<>v_old.version then
      raise exception 'stale RSVP version' using errcode='40001';
    end if;
    v_id:=v_old.id;
    v_version:=v_old.version+1;
    v_ack:=v_old.rule_acknowledgment_id;
  else
    if coalesce(p_expected_version,0)<>0 then
      raise exception 'stale RSVP version' using errcode='40001';
    end if;
    v_id:=gen_random_uuid();
    v_version:=1;
  end if;
  if p_response='coming' and (not v_existing or v_old.response<>'coming') then
    select * into v_current_bundle from public.trip_rule_bundles where trip_id=p_trip_id and is_current;
    if v_current_bundle.id is null or p_bundle_id is distinct from v_current_bundle.id or p_content_hash is distinct from v_current_bundle.content_hash then
      raise exception 'current Camping Constitution acknowledgment required' using errcode='22023';
    end if;
    select id into v_ack from public.trip_rule_acknowledgments where member_id=v_member and trip_id=p_trip_id and bundle_id=v_current_bundle.id and statement_version='coming-v1';
    if v_ack is null then
      insert into public.trip_rule_acknowledgments(trip_id,member_id,bundle_id,content_hash,statement_version,request_id)
        values(p_trip_id,v_member,v_current_bundle.id,v_current_bundle.content_hash,'coming-v1',p_request_id) returning id into v_ack;
    end if;
  elsif p_response='coming' and v_ack is null then
    raise exception 'current Camping Constitution acknowledgment required' using errcode='22023';
  end if;
  if p_response='coming' and (not v_existing or v_old.response<>'coming') and v_trip.max_capacity is not null
    and (select count(*) from public.trip_rsvps where trip_id=p_trip_id and response='coming')>=v_trip.max_capacity then
    raise exception 'interest poll capacity reached' using errcode='22023';
  end if;
  if v_existing then
    update public.trip_rsvps set response=p_response,rule_acknowledgment_id=v_ack,version=v_version,updated_at=now() where id=v_id;
    v_event:=case when v_old.response=p_response then null else 'changed' end;
  else
    insert into public.trip_rsvps(id,trip_id,member_id,response,rule_acknowledgment_id,version) values(v_id,p_trip_id,v_member,p_response,v_ack,v_version);
    v_event:='submitted';
  end if;
  if v_event is not null then
    insert into public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id)
      values(p_trip_id,v_member,v_member,v_event,case when v_existing then v_old.response else null end,p_response,v_ack,p_request_id);
  end if;
  if p_response='not_coming' then
    update public.trip_duty_assignments
    set status = 'dropped', released_at = now(), released_by = v_member, release_reason = 'RSVP changed to Not Going', updated_at = now()
    where trip_id = p_trip_id and member_id = v_member and status in ('claimed', 'assigned_by_admin');
  end if;
  return jsonb_build_object('rsvpId',v_id,'response',p_response,'version',v_version,'acknowledgmentId',v_ack);
end $$;

-- 3. Update phase2_admin_record_interest to allow roster updates before or after confirmation
create or replace function public.phase2_admin_record_interest(
  p_actor_id uuid,p_trip_id uuid,p_member_id uuid,p_response text,p_expected_version integer,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  v_trip public.camping_trips%rowtype;
  v_old public.trip_rsvps%rowtype;
  v_member public.member_profiles%rowtype;
  v_bundle uuid;
  v_ack uuid;
  v_id uuid;
  v_version integer;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_response not in ('coming','not_coming') or p_reason is null or length(btrim(p_reason))=0 or p_request_id is null then
    raise exception 'invalid administrator poll entry';
  end if;
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found or v_trip.deleted_at is not null or v_trip.event_status='cancelled' or v_trip.poll_status='draft' or v_trip.ends_on is null or v_trip.ends_on < (now() at time zone coalesce(v_trip.club_timezone_snapshot,'America/Los_Angeles'))::date then
    raise exception 'camping event is closed';
  end if;
  select * into v_member from public.member_profiles where member_id=p_member_id and account_status='active';
  if not found then
    raise exception 'active member required';
  end if;
  if p_response='coming' and not exists(select 1 from public.trip_rsvps where trip_id=p_trip_id and member_id=p_member_id and response='coming') then
    perform private.phase2_build_rule_bundle(p_trip_id,p_actor_id);
  end if;
  select * into v_old from public.trip_rsvps where trip_id=p_trip_id and member_id=p_member_id for update;
  if found then
    if p_expected_version is null or v_old.version<>p_expected_version then
      raise exception 'stale RSVP version' using errcode='40001';
    end if;
    v_id:=v_old.id; v_version:=v_old.version+1; v_ack:=v_old.rule_acknowledgment_id;
  else
    if coalesce(p_expected_version,0)<>0 then
      raise exception 'stale RSVP version' using errcode='40001';
    end if;
    v_id:=gen_random_uuid(); v_version:=1;
  end if;
  if p_response='coming' then
    select id into v_bundle from public.trip_rule_bundles where trip_id=p_trip_id and is_current;
    if v_old.rule_acknowledgment_id is not null and v_old.response='coming' then
      v_ack:=v_old.rule_acknowledgment_id;
    else
      select id into v_ack from public.trip_rule_acknowledgments where member_id=p_member_id and trip_id=p_trip_id and bundle_id=v_bundle and statement_version='coming-v1';
      if v_ack is null then
        raise exception 'member must personally acknowledge the current rule bundle';
      end if;
    end if;
    if v_trip.max_capacity is not null and (v_old.id is null or v_old.response<>'coming')
      and (select count(*) from public.trip_rsvps where trip_id=p_trip_id and response='coming')>=v_trip.max_capacity then
      raise exception 'interest poll capacity reached';
    end if;
  end if;
  if v_old.id is null then
    insert into public.trip_rsvps(id,trip_id,member_id,response,rule_acknowledgment_id,version)
      values(v_id,p_trip_id,p_member_id,p_response,v_ack,v_version);
  else
    update public.trip_rsvps
      set response=p_response,rule_acknowledgment_id=v_ack,version=v_version,updated_at=now()
      where id=v_id;
  end if;
  insert into public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
    values(p_trip_id,p_member_id,p_actor_id,'admin_interest_recorded',case when v_old.id is not null then v_old.response else null end,p_response,v_ack,p_request_id,btrim(p_reason));
  if p_response='not_coming' then
    update public.trip_duty_assignments
    set status = 'dropped', released_at = now(), released_by = p_actor_id, release_reason = 'Roster updated by administrator', updated_at = now()
    where trip_id = p_trip_id and member_id = p_member_id and status in ('claimed', 'assigned_by_admin');
  end if;
  return jsonb_build_object('rsvpId',v_id,'response',p_response,'version',v_version,'acknowledgmentId',v_ack);
end $$;

-- 4. Permissions
revoke all on function public.phase1_update_membership(uuid,uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.phase1_update_membership(uuid,uuid,text,text,text,uuid) to service_role;

revoke all on function public.phase2_submit_rsvp(uuid,uuid,text,uuid,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.phase2_submit_rsvp(uuid,uuid,text,uuid,text,integer,uuid) to service_role;

revoke all on function public.phase2_admin_record_interest(uuid,uuid,uuid,text,integer,text,uuid) from public, anon, authenticated;
grant execute on function public.phase2_admin_record_interest(uuid,uuid,uuid,text,integer,text,uuid) to service_role;

-- Late additions must see the current rules before personally acknowledging them.
create or replace function public.phase2_refresh_open_rule_bundles(p_actor_id uuid,p_trip_ids uuid[])
returns integer language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_trip uuid; v_refreshed integer:=0;
begin
  if p_actor_id is null or not exists(
    select 1 from public.member_profiles where member_id=p_actor_id and account_status='active' and member_role in ('member','admin')
  ) then raise exception 'active member required' using errcode='42501'; end if;
  if p_trip_ids is null then raise exception 'trip list is required'; end if;
  for v_trip in select distinct t.id from public.camping_trips t where t.id=any(p_trip_ids) and t.poll_status<>'draft' and t.event_status<>'cancelled' and t.deleted_at is null order by t.id loop
    perform private.phase2_build_rule_bundle(v_trip,p_actor_id);
    v_refreshed:=v_refreshed+1;
  end loop;
  return v_refreshed;
end $$;


-- Repair existing stale upcoming participation for accounts already disabled.
-- System-authored migration events preserve the original membership audit actor.
with changed as (
  update public.trip_rsvps r set response='not_coming',version=r.version+1,updated_at=now()
  from public.member_profiles m, public.camping_trips t
  where r.member_id=m.member_id and r.trip_id=t.id and m.account_status in ('inactive','suspended')
    and r.response='coming' and t.deleted_at is null
    and coalesce(t.ends_on,t.starts_on,t.month_key)>=(now() at time zone coalesce(t.club_timezone_snapshot,'America/Los_Angeles'))::date
  returning r.trip_id,r.member_id,r.rule_acknowledgment_id
)
insert into public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
select trip_id,member_id,null,'changed','coming','not_coming',rule_acknowledgment_id,gen_random_uuid(),
  'Maintenance: remove upcoming participation for previously disabled account' from changed;

update public.trip_duty_assignments a set status='dropped',released_at=now(),released_by=null,
  release_reason='Maintenance: previously disabled account',updated_at=now()
from public.member_profiles m,public.camping_trips t
where a.member_id=m.member_id and a.trip_id=t.id and m.account_status in ('inactive','suspended')
  and a.status in ('claimed','assigned_by_admin') and t.deleted_at is null
  and coalesce(t.ends_on,t.starts_on,t.month_key)>=(now() at time zone coalesce(t.club_timezone_snapshot,'America/Los_Angeles'))::date;

update public.trip_waitlist_entries w set status='removed',resolved_at=now()
from public.member_profiles m,public.camping_trips t
where w.member_id=m.member_id and w.trip_id=t.id and m.account_status in ('inactive','suspended')
  and w.status='waiting' and t.deleted_at is null
  and coalesce(t.ends_on,t.starts_on,t.month_key)>=(now() at time zone coalesce(t.club_timezone_snapshot,'America/Los_Angeles'))::date;
