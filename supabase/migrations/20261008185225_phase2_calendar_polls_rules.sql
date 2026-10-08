-- Phase 2: rolling monthly interest polls, site rotation, and immutable rules.
-- Formal registration decisions and all cabin/payment operations remain out of scope.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create table public.club_configuration (
  singleton boolean primary key default true check (singleton),
  club_timezone text,
  default_poll_lead_days smallint not null default 35 check (default_poll_lead_days between 1 and 120),
  default_poll_close_time time,
  default_minimum_participants smallint not null default 4 check (default_minimum_participants between 1 and 100),
  next_month_to_generate date not null default ((date_trunc('month',current_date)::date + interval '1 month')::date),
  next_rotation_position integer not null default 1 check (next_rotation_position > 0),
  version integer not null default 1 check (version > 0),
  updated_by uuid references public.member_profiles(member_id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.campsites (
  id uuid primary key default gen_random_uuid(),
  rotation_position integer unique,
  name text not null unique check (length(btrim(name)) between 1 and 120),
  availability_url text,
  location_description text not null default '',
  directions text,
  cabin_capacity integer check (cabin_capacity is null or cabin_capacity > 0),
  cabin_types jsonb not null default '[]'::jsonb check (jsonb_typeof(cabin_types)='array'),
  reservation_instructions text,
  estimated_rate_cents bigint check (estimated_rate_cents is null or estimated_rate_cents >= 0),
  availability_status text not null default 'unknown' check (availability_status in ('available','limited','unavailable','unknown','manual_confirmation')),
  availability_source_url text,
  availability_verified_at timestamptz,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.member_profiles(member_id) on delete set null,
  updated_by uuid references public.member_profiles(member_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((active and rotation_position is not null and rotation_position > 0) or (not active and rotation_position is null)),
  check (availability_url is null or availability_url ~ '^https://')
);
create index campsites_active_rotation_idx on public.campsites(rotation_position) where active;

create table private.campsite_admin_notes (
  campsite_id uuid primary key references public.campsites(id) on delete restrict,
  admin_notes text not null default '',
  updated_by uuid references public.member_profiles(member_id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.camping_trips (
  id uuid primary key default gen_random_uuid(),
  month_key date not null unique check (extract(day from month_key)=1),
  rotation_position integer not null check (rotation_position > 0),
  suggested_campsite_id uuid not null references public.campsites(id) on delete restrict,
  selected_campsite_id uuid not null references public.campsites(id) on delete restrict,
  starts_on date,
  ends_on date,
  club_timezone_snapshot text,
  poll_deadline_at timestamptz,
  minimum_participants smallint not null default 4 check (minimum_participants between 1 and 100),
  minimum_basis text check (minimum_basis is null or minimum_basis in ('coming_rsvp','received_contribution')),
  max_capacity smallint check (max_capacity is null or max_capacity between 1 and 100),
  poll_status text not null default 'draft' check (poll_status in ('draft','open','closed')),
  additional_information text not null default '',
  cabin_availability_status text not null default 'unknown' check (cabin_availability_status in ('available','limited','unavailable','unknown','manual_confirmation')),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.member_profiles(member_id) on delete set null,
  updated_by uuid references public.member_profiles(member_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((starts_on is null and ends_on is null) or (starts_on is not null and ends_on is not null and ends_on >= starts_on)),
  check (poll_status <> 'open' or (starts_on is not null and ends_on is not null and club_timezone_snapshot is not null and poll_deadline_at is not null))
);
create index camping_trips_month_idx on public.camping_trips(month_key);
create index camping_trips_selected_site_idx on public.camping_trips(selected_campsite_id,month_key);
create index camping_trips_open_deadline_idx on public.camping_trips(poll_deadline_at) where poll_status='open';

create table public.trip_poll_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete restrict,
  actor_id uuid references public.member_profiles(member_id) on delete set null,
  event_type text not null check (event_type in ('calendar_month_generated','poll_opened','poll_closed','poll_reopened','trip_configured','campsite_overridden','rotation_reordered')),
  from_status text,
  to_status text,
  request_id uuid not null,
  reason text,
  event_details jsonb not null default '{}'::jsonb check (jsonb_typeof(event_details)='object'),
  created_at timestamptz not null default now(),
  unique(trip_id,request_id,event_type)
);
create index trip_poll_events_trip_created_idx on public.trip_poll_events(trip_id,created_at desc);

create table public.rule_definitions (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  category text not null check (category in ('participation','transport','cabin','expenses','lodging','meals','conduct','custom')),
  scope text not null check (scope in ('general','trip')),
  trip_id uuid references public.camping_trips(id) on delete restrict,
  active boolean not null default true,
  created_by uuid references public.member_profiles(member_id) on delete set null,
  created_at timestamptz not null default now(),
  check ((scope='general' and trip_id is null) or (scope='trip' and trip_id is not null))
);
create unique index rule_definitions_general_key_idx on public.rule_definitions(stable_key) where scope='general';
create unique index rule_definitions_trip_key_idx on public.rule_definitions(trip_id,stable_key) where scope='trip';

create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.rule_definitions(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  human_text text not null check (length(btrim(human_text)) between 1 and 8000),
  structured_values jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_values)='object' and octet_length(structured_values::text) <= 16000),
  effective_from timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references public.member_profiles(member_id) on delete set null,
  created_at timestamptz not null default now(),
  unique(definition_id,version_no),
  check (expires_at is null or expires_at > effective_from)
);
create index rule_versions_definition_effective_idx on public.rule_versions(definition_id,effective_from desc,version_no desc);

create table public.trip_rule_overrides (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete restrict,
  general_rule_definition_id uuid not null references public.rule_definitions(id) on delete restrict,
  base_rule_version_id uuid not null references public.rule_versions(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  human_text text not null check (length(btrim(human_text)) between 1 and 8000),
  structured_values jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_values)='object' and octet_length(structured_values::text) <= 16000),
  expires_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_by uuid not null references public.member_profiles(member_id) on delete restrict,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique(trip_id,general_rule_definition_id,version_no)
);
create unique index trip_rule_overrides_current_idx on public.trip_rule_overrides(trip_id,general_rule_definition_id) where retired_at is null;

create table public.trip_rule_bundles (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  rendered_bundle jsonb not null check (jsonb_typeof(rendered_bundle)='array'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_current boolean not null default true,
  created_by uuid references public.member_profiles(member_id) on delete set null,
  created_at timestamptz not null default now(),
  unique(trip_id,version_no),
  unique(id,trip_id)
);
create unique index trip_rule_bundles_current_idx on public.trip_rule_bundles(trip_id) where is_current;

create table public.trip_rule_bundle_entries (
  bundle_id uuid not null references public.trip_rule_bundles(id) on delete restrict,
  entry_id uuid not null,
  rule_version_id uuid references public.rule_versions(id) on delete restrict,
  override_id uuid references public.trip_rule_overrides(id) on delete restrict,
  source_kind text not null check (source_kind in ('general','trip','override')),
  primary key(bundle_id,entry_id),
  check ((source_kind='override' and override_id is not null and rule_version_id is null) or (source_kind<>'override' and rule_version_id is not null and override_id is null))
);
create unique index trip_rule_bundle_entry_version_idx on public.trip_rule_bundle_entries(bundle_id,rule_version_id) where rule_version_id is not null;
create unique index trip_rule_bundle_entry_override_idx on public.trip_rule_bundle_entries(bundle_id,override_id) where override_id is not null;

create table public.trip_rule_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete restrict,
  member_id uuid not null references public.member_profiles(member_id) on delete restrict,
  bundle_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  statement_version text not null check (length(statement_version) between 1 and 80),
  request_id uuid not null,
  acknowledged_at timestamptz not null default now(),
  foreign key(bundle_id,trip_id) references public.trip_rule_bundles(id,trip_id) on delete restrict,
  unique(member_id,trip_id,bundle_id,statement_version),
  unique(id,trip_id,member_id)
);
create index trip_rule_ack_member_idx on public.trip_rule_acknowledgments(member_id,trip_id,acknowledged_at desc);

create table public.trip_rsvps (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete restrict,
  member_id uuid not null references public.member_profiles(member_id) on delete restrict,
  response text not null check (response in ('coming','not_coming')),
  rule_acknowledgment_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id,member_id),
  foreign key(rule_acknowledgment_id,trip_id,member_id) references public.trip_rule_acknowledgments(id,trip_id,member_id) on delete restrict,
  check (response <> 'coming' or rule_acknowledgment_id is not null)
);
create index trip_rsvps_trip_response_idx on public.trip_rsvps(trip_id,response);
create index trip_rsvps_member_idx on public.trip_rsvps(member_id,updated_at desc);

create table public.trip_rsvp_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete restrict,
  member_id uuid not null references public.member_profiles(member_id) on delete restrict,
  actor_id uuid references public.member_profiles(member_id) on delete set null,
  event_type text not null check (event_type in ('submitted','changed','withdrawal_requested','admin_interest_recorded')),
  from_response text check (from_response is null or from_response in ('coming','not_coming')),
  to_response text check (to_response is null or to_response in ('coming','not_coming')),
  rule_acknowledgment_id uuid references public.trip_rule_acknowledgments(id) on delete restrict,
  request_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  unique(member_id,request_id)
);
create index trip_rsvp_events_trip_created_idx on public.trip_rsvp_events(trip_id,created_at desc);

create table public.trip_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete restrict,
  member_id uuid not null references public.member_profiles(member_id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique(member_id,request_id),
  unique(trip_id,member_id)
);
create index trip_withdrawal_requests_trip_idx on public.trip_withdrawal_requests(trip_id,created_at);

create or replace function private.phase2_immutable_row()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  raise exception 'phase 2 history rows are immutable' using errcode='42501';
end $$;

create or replace function private.phase2_bundle_content_guard()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(new) - 'is_current') <> (to_jsonb(old) - 'is_current') or old.is_current=false or new.is_current=true then
    raise exception 'rule bundle content is immutable' using errcode='42501';
  end if;
  return new;
end $$;

create or replace function private.phase2_override_retire_guard()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(new) - 'retired_at') <> (to_jsonb(old) - 'retired_at') or old.retired_at is not null or new.retired_at is null then
    raise exception 'rule override content is immutable' using errcode='42501';
  end if;
  return new;
end $$;

create trigger trip_poll_events_immutable before update or delete on public.trip_poll_events for each row execute function private.phase2_immutable_row();
create trigger trip_rsvp_events_immutable before update or delete on public.trip_rsvp_events for each row execute function private.phase2_immutable_row();
create trigger trip_rule_versions_immutable before update or delete on public.rule_versions for each row execute function private.phase2_immutable_row();
create trigger trip_rule_bundle_entries_immutable before update or delete on public.trip_rule_bundle_entries for each row execute function private.phase2_immutable_row();
create trigger trip_rule_acknowledgments_immutable before update or delete on public.trip_rule_acknowledgments for each row execute function private.phase2_immutable_row();
create trigger trip_rule_bundles_content_guard before update on public.trip_rule_bundles for each row execute function private.phase2_bundle_content_guard();
create trigger trip_rule_bundles_no_delete before delete on public.trip_rule_bundles for each row execute function private.phase2_immutable_row();
create trigger trip_rule_overrides_content_guard before update on public.trip_rule_overrides for each row execute function private.phase2_override_retire_guard();
create trigger trip_rule_overrides_no_delete before delete on public.trip_rule_overrides for each row execute function private.phase2_immutable_row();

insert into public.club_configuration(singleton) values (true);
insert into public.campsites(id,rotation_position,name,availability_url,location_description,availability_status)
values
  ('a2000000-0000-4000-8000-000000000001',1,'Del Monte','https://www.psea.info/psea-camps/del-monte-rate-and-availability/','', 'unknown'),
  ('a2000000-0000-4000-8000-000000000002',2,'Wishon Cove','https://www.psea.info/psea-camps/wishon-rate-and-availability/','', 'unknown'),
  ('a2000000-0000-4000-8000-000000000003',3,'DeSabla','https://www.psea.info/psea-camps/desabla-rate-and-availability/','', 'unknown'),
  ('a2000000-0000-4000-8000-000000000004',4,'Almanor','https://www.psea.info/psea-camps/almanor-rate-availability/','', 'unknown'),
  ('a2000000-0000-4000-8000-000000000005',5,'Shasta','https://www.psea.info/psea-camps/shasta-rate-and-availability/','', 'unknown'),
  ('a2000000-0000-4000-8000-000000000006',6,'Britton','https://www.psea.info/psea-camps/britton-rate-and-availability/','', 'unknown'),
  ('a2000000-0000-4000-8000-000000000007',7,'Pit River','https://www.psea.info/psea-camps/pit-river-rate-and-availability/','', 'unknown');
insert into public.rule_definitions(id,stable_key,category,scope)
values ('b2000000-0000-4000-8000-000000000001','poll-interest-disclosure','participation','general');
insert into public.rule_versions(id,definition_id,version_no,human_text,structured_values,effective_from)
values (
  'b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',1,
  'A Coming response is an expression of interest in this monthly poll. It does not confirm the trip or create a payment obligation. The current poll status and any later owner-approved trip decision are shown separately. Members acknowledge the exact rule bundle presented with their Coming response.',
  '{"response_type":"interest","automatic_trip_decision":false,"payment_obligation_on_coming":false}'::jsonb,now());

alter table public.club_configuration enable row level security;
alter table public.campsites enable row level security;
alter table public.camping_trips enable row level security;
alter table public.trip_poll_events enable row level security;
alter table public.rule_definitions enable row level security;
alter table public.rule_versions enable row level security;
alter table public.trip_rule_overrides enable row level security;
alter table public.trip_rule_bundles enable row level security;
alter table public.trip_rule_bundle_entries enable row level security;
alter table public.trip_rule_acknowledgments enable row level security;
alter table public.trip_rsvps enable row level security;
alter table public.trip_rsvp_events enable row level security;
alter table public.trip_withdrawal_requests enable row level security;

create policy active_members_read_club_configuration on public.club_configuration for select to authenticated using (
  exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy active_members_read_campsites on public.campsites for select to authenticated using (
  active and exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy active_members_read_calendar on public.camping_trips for select to authenticated using (
  exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy active_members_read_rule_definitions on public.rule_definitions for select to authenticated using (
  active and exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy active_members_read_rule_versions on public.rule_versions for select to authenticated using (
  exists(select 1 from public.rule_definitions d where d.id=definition_id and d.active)
  and exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy active_members_read_trip_rule_overrides on public.trip_rule_overrides for select to authenticated using (
  retired_at is null and exists(select 1 from public.camping_trips t where t.id=trip_id)
  and exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy active_members_read_rule_bundles on public.trip_rule_bundles for select to authenticated using (
  exists(select 1 from public.camping_trips t where t.id=trip_id)
  and exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy active_members_read_rule_bundle_entries on public.trip_rule_bundle_entries for select to authenticated using (
  exists(select 1 from public.trip_rule_bundles b join public.camping_trips t on t.id=b.trip_id where b.id=bundle_id)
  and exists(select 1 from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
);
create policy members_read_own_rule_acknowledgments on public.trip_rule_acknowledgments for select to authenticated using (
  member_id=(select m.member_id from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
  or exists(select 1 from public.member_profiles a where a.auth_user_id=(select auth.uid()) and a.member_role='admin' and a.account_status='active')
);
create policy members_read_own_rsvp on public.trip_rsvps for select to authenticated using (
  member_id=(select m.member_id from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
  or exists(select 1 from public.member_profiles a where a.auth_user_id=(select auth.uid()) and a.member_role='admin' and a.account_status='active')
);
create policy members_read_own_withdrawal_request on public.trip_withdrawal_requests for select to authenticated using (
  member_id=(select m.member_id from public.member_profiles m where m.auth_user_id=(select auth.uid()) and m.account_status='active')
  or exists(select 1 from public.member_profiles a where a.auth_user_id=(select auth.uid()) and a.member_role='admin' and a.account_status='active')
);
create policy admins_read_poll_events on public.trip_poll_events for select to authenticated using (
  exists(select 1 from public.member_profiles a where a.auth_user_id=(select auth.uid()) and a.member_role='admin' and a.account_status='active')
);

revoke all on public.club_configuration,public.campsites,public.camping_trips,public.trip_poll_events,
  public.rule_definitions,public.rule_versions,public.trip_rule_overrides,public.trip_rule_bundles,
  public.trip_rule_bundle_entries,public.trip_rule_acknowledgments,public.trip_rsvps,
  public.trip_rsvp_events,public.trip_withdrawal_requests from anon,authenticated;
grant select on public.club_configuration,public.campsites,public.camping_trips,public.rule_definitions,
  public.rule_versions,public.trip_rule_overrides,
  public.trip_rule_acknowledgments,public.trip_rsvps,public.trip_withdrawal_requests to authenticated;
grant select on public.trip_poll_events to authenticated;
grant all on public.club_configuration,public.campsites,public.camping_trips,public.trip_poll_events,
  public.rule_definitions,public.rule_versions,public.trip_rule_overrides,public.trip_rule_bundles,
  public.trip_rule_bundle_entries,public.trip_rule_acknowledgments,public.trip_rsvps,
  public.trip_rsvp_events,public.trip_withdrawal_requests to service_role;
grant all on private.campsite_admin_notes to service_role;

revoke all on function private.phase2_immutable_row() from public,anon,authenticated;
revoke all on function private.phase2_bundle_content_guard() from public,anon,authenticated;
revoke all on function private.phase2_override_retire_guard() from public,anon,authenticated;

create function private.phase2_require_admin(p_actor_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if p_actor_id is null or not exists(select 1 from public.member_profiles where member_id=p_actor_id and member_role='admin' and account_status='active') then
    raise exception 'active administrator required' using errcode='42501';
  end if;
end $$;

create function public.phase2_admin_get_campsite_notes(p_actor_id uuid)
returns table(campsite_id uuid,admin_notes text)
language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
  perform private.phase2_require_admin(p_actor_id);
  return query select n.campsite_id,n.admin_notes from private.campsite_admin_notes n order by n.campsite_id;
end $$;

create function private.phase2_build_rule_bundle(p_trip_id uuid,p_actor_id uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public,private,extensions as $$
declare v_bundle uuid; v_current_hash text; v_version integer; v_rendered jsonb; v_hash text; v_as_of timestamptz:=clock_timestamp();
begin
  perform 1 from public.camping_trips where id=p_trip_id for update;
  if not found then raise exception 'trip poll not found'; end if;

  with general_latest as (
    select distinct on(d.id) d.id definition_id,d.stable_key,rv.id version_id,rv.version_no,rv.human_text,rv.structured_values,rv.expires_at
    from public.rule_definitions d join public.rule_versions rv on rv.definition_id=d.id
    where d.scope='general' and d.active and rv.effective_from<=v_as_of and (rv.expires_at is null or rv.expires_at>v_as_of)
    order by d.id,rv.effective_from desc,rv.version_no desc
  ), general_effective as (
    select g.*,o.id override_id,o.version_no override_version,o.human_text override_text,o.structured_values override_values,o.expires_at override_expires
    from general_latest g left join lateral (
      select x.* from public.trip_rule_overrides x
      where x.trip_id=p_trip_id and x.general_rule_definition_id=g.definition_id and x.base_rule_version_id=g.version_id
        and x.retired_at is null and x.expires_at>v_as_of
      order by x.version_no desc limit 1
    ) o on true
  ), trip_latest as (
    select distinct on(d.id) d.id definition_id,d.stable_key,rv.id version_id,rv.version_no,rv.human_text,rv.structured_values,rv.expires_at
    from public.rule_definitions d join public.rule_versions rv on rv.definition_id=d.id
    where d.scope='trip' and d.trip_id=p_trip_id and d.active and rv.effective_from<=v_as_of and rv.expires_at>v_as_of
    order by d.id,rv.effective_from desc,rv.version_no desc
  ), items as (
    select g.stable_key,jsonb_build_object(
      'stable_key',g.stable_key,'definition_id',g.definition_id,
      'version_id',coalesce(g.override_id,g.version_id),'version_no',coalesce(g.override_version,g.version_no),
      'text',coalesce(g.override_text,g.human_text),'structured_values',coalesce(g.override_values,g.structured_values),
      'source',case when g.override_id is null then 'general' else 'override' end,
      'expires_at',coalesce(g.override_expires,g.expires_at)
    ) rule_item
    from general_effective g
    union all
    select t.stable_key,jsonb_build_object(
      'stable_key',t.stable_key,'definition_id',t.definition_id,'version_id',t.version_id,
      'version_no',t.version_no,'text',t.human_text,'structured_values',t.structured_values,
      'source','trip','expires_at',t.expires_at
    ) rule_item from trip_latest t
  )
  select coalesce(jsonb_agg(rule_item order by stable_key,rule_item->>'version_id'),'[]'::jsonb) into v_rendered from items;

  v_hash := encode(extensions.digest(convert_to(v_rendered::text,'UTF8'),'sha256'),'hex');
  select id,content_hash into v_bundle,v_current_hash from public.trip_rule_bundles where trip_id=p_trip_id and is_current for update;
  if v_bundle is not null and v_current_hash=v_hash then return v_bundle; end if;
  update public.trip_rule_bundles set is_current=false where trip_id=p_trip_id and is_current;
  select coalesce(max(version_no),0)+1 into v_version from public.trip_rule_bundles where trip_id=p_trip_id;
  insert into public.trip_rule_bundles(trip_id,version_no,rendered_bundle,content_hash,created_by)
    values(p_trip_id,v_version,v_rendered,v_hash,p_actor_id) returning id into v_bundle;

  with general_latest as (
    select distinct on(d.id) d.id definition_id,rv.id version_id
    from public.rule_definitions d join public.rule_versions rv on rv.definition_id=d.id
    where d.scope='general' and d.active and rv.effective_from<=v_as_of and (rv.expires_at is null or rv.expires_at>v_as_of)
    order by d.id,rv.effective_from desc,rv.version_no desc
  ), general_effective as (
    select g.definition_id,g.version_id,o.id override_id
    from general_latest g left join lateral (
      select x.id from public.trip_rule_overrides x
      where x.trip_id=p_trip_id and x.general_rule_definition_id=g.definition_id and x.base_rule_version_id=g.version_id
        and x.retired_at is null and x.expires_at>v_as_of
      order by x.version_no desc limit 1
    ) o on true
  )
  insert into public.trip_rule_bundle_entries(bundle_id,entry_id,rule_version_id,override_id,source_kind)
  select v_bundle,coalesce(g.override_id,g.version_id),case when g.override_id is null then g.version_id else null end,g.override_id,
    case when g.override_id is null then 'general' else 'override' end
  from general_effective g;

  insert into public.trip_rule_bundle_entries(bundle_id,entry_id,rule_version_id,override_id,source_kind)
  select v_bundle,rv.id,rv.id,null,'trip'
  from public.rule_definitions d join public.rule_versions rv on rv.definition_id=d.id
  where d.scope='trip' and d.trip_id=p_trip_id and d.active and rv.effective_from<=v_as_of and rv.expires_at>v_as_of
    and rv.version_no=(select max(rv2.version_no) from public.rule_versions rv2 where rv2.definition_id=d.id and rv2.effective_from<=v_as_of and rv2.expires_at>v_as_of);
  return v_bundle;
end $$;

create function public.phase2_refresh_open_rule_bundles(p_actor_id uuid,p_trip_ids uuid[])
returns integer language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_trip uuid; v_refreshed integer:=0;
begin
  if p_actor_id is null or not exists(
    select 1 from public.member_profiles where member_id=p_actor_id and account_status='active' and member_role in ('member','admin')
  ) then raise exception 'active member required' using errcode='42501'; end if;
  if p_trip_ids is null then raise exception 'trip list is required'; end if;
  for v_trip in select distinct t.id from public.camping_trips t where t.id=any(p_trip_ids) and t.poll_status='open' order by t.id loop
    perform private.phase2_build_rule_bundle(v_trip,p_actor_id);
    v_refreshed:=v_refreshed+1;
  end loop;
  return v_refreshed;
end $$;

create function public.phase2_generate_calendar(p_actor_id uuid,p_through_month date,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_config public.club_configuration%rowtype; v_count integer; v_position integer; v_month date; v_site uuid; v_trip uuid; v_generated integer:=0; v_site_count integer;
begin
  if p_through_month is null or extract(day from p_through_month)<>1 or p_request_id is null then raise exception 'invalid calendar range'; end if;
  if p_actor_id is not null then perform private.phase2_require_admin(p_actor_id);
  elsif current_user not in ('postgres','supabase_admin') then raise exception 'trusted scheduler required' using errcode='42501'; end if;
  select * into v_config from public.club_configuration where singleton for update;
  select count(*) into v_site_count from public.campsites where active;
  if v_site_count<7 then raise exception 'at least seven active campsites are required'; end if;
  if (select count(*) from public.campsites where active) <> (select count(distinct rotation_position) from public.campsites where active)
    or (select min(rotation_position) from public.campsites where active)<>1
    or (select max(rotation_position) from public.campsites where active)<>v_site_count then
    raise exception 'active campsite rotation positions must be unique and contiguous from one';
  end if;
  if v_config.next_rotation_position>v_site_count then raise exception 'configured next rotation position is outside the active rotation'; end if;
  v_month:=v_config.next_month_to_generate;
  v_position:=v_config.next_rotation_position;
  while v_month<=p_through_month loop
    select id into v_site from public.campsites where active and rotation_position=v_position;
    insert into public.camping_trips(month_key,rotation_position,suggested_campsite_id,selected_campsite_id,minimum_participants,created_by,updated_by)
      values(v_month,v_position,v_site,v_site,v_config.default_minimum_participants,p_actor_id,p_actor_id)
      on conflict(month_key) do nothing returning id into v_trip;
    if v_trip is not null then
      perform private.phase2_build_rule_bundle(v_trip,p_actor_id);
      insert into public.trip_poll_events(trip_id,actor_id,event_type,to_status,request_id,event_details)
        values(v_trip,p_actor_id,'calendar_month_generated','draft',p_request_id,jsonb_build_object('month_key',v_month,'rotation_position',v_position,'suggested_campsite_id',v_site));
      v_generated:=v_generated+1;
    end if;
    v_trip:=null;
    v_month:=(v_month+interval '1 month')::date;
    v_position:=case when v_position>=v_site_count then 1 else v_position+1 end;
  end loop;
  update public.club_configuration set next_month_to_generate=v_month,next_rotation_position=v_position,
    updated_by=p_actor_id,updated_at=now(),version=version+case when v_generated>0 then 1 else 0 end where singleton;
  return jsonb_build_object('generated_count',v_generated,'through_month',p_through_month,'next_month_to_generate',v_month,'next_rotation_position',v_position);
end $$;

create function public.phase2_close_due_polls()
returns integer language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_trip record; v_closed integer:=0;
begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'trusted scheduler required' using errcode='42501'; end if;
  for v_trip in select id,poll_status from public.camping_trips where poll_status='open' and poll_deadline_at<=now() order by poll_deadline_at for update skip locked loop
    update public.camping_trips set poll_status='closed',version=version+1,updated_at=now() where id=v_trip.id;
    insert into public.trip_poll_events(trip_id,event_type,from_status,to_status,request_id,reason,event_details)
      values(v_trip.id,'poll_closed','open','closed',gen_random_uuid(),'deadline_reached',jsonb_build_object('deadline_processed_at',now()));
    v_closed:=v_closed+1;
  end loop;
  return v_closed;
end $$;

create function public.phase2_configure_club(p_actor_id uuid,p_timezone text,p_lead_days integer,p_close_time time,p_default_minimum integer,p_next_rotation_position integer,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_config public.club_configuration%rowtype;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_timezone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid IANA timezone'; end if;
  if p_lead_days not between 1 and 120 or p_default_minimum not between 1 and 100 or p_next_rotation_position<1 or p_request_id is null then raise exception 'invalid club configuration'; end if;
  select * into v_config from public.club_configuration where singleton for update;
  if v_config.version<>p_expected_version then raise exception 'stale club configuration' using errcode='40001'; end if;
  if p_next_rotation_position>(select count(*) from public.campsites where active) then raise exception 'rotation start outside active sites'; end if;
  update public.club_configuration set club_timezone=p_timezone,default_poll_lead_days=p_lead_days,
    default_poll_close_time=p_close_time,default_minimum_participants=p_default_minimum,
    next_rotation_position=p_next_rotation_position,updated_by=p_actor_id,updated_at=now(),version=version+1 where singleton;
  insert into public.audit_events(actor_id,actor_kind,entity_type,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','club_configuration','club_configuration_updated','Phase 2 schedule settings updated',p_request_id,
      extensions.digest(convert_to(jsonb_build_object('timezone',p_timezone,'default_poll_lead_days',p_lead_days,'default_minimum_participants',p_default_minimum,'next_rotation_position',p_next_rotation_position)::text,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
  return jsonb_build_object('version',v_config.version+1);
end $$;

create function public.phase2_admin_reorder_campsites(p_actor_id uuid,p_order uuid[],p_next_rotation_position integer,p_reason text,p_request_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_count integer; v_site uuid; v_position integer:=0;
begin
  perform private.phase2_require_admin(p_actor_id);
  perform 1 from public.club_configuration where singleton for update;
  select count(*) into v_count from public.campsites where active;
  if cardinality(p_order)<>v_count or cardinality(p_order)<7 or cardinality(p_order)<>(select count(distinct x) from unnest(p_order) x)
     or p_next_rotation_position<1 or p_next_rotation_position>v_count or p_reason is null or length(btrim(p_reason))=0 then
    raise exception 'rotation order must list every active campsite exactly once';
  end if;
  if exists(select 1 from unnest(p_order) x left join public.campsites c on c.id=x where c.id is null or not c.active) then raise exception 'rotation order contains an inactive or unknown campsite'; end if;
  update public.campsites set rotation_position=rotation_position+100000,updated_by=p_actor_id,updated_at=now() where active;
  foreach v_site in array p_order loop
    v_position:=v_position+1;
    update public.campsites set rotation_position=v_position,version=version+1 where id=v_site;
  end loop;
  update public.club_configuration set next_rotation_position=p_next_rotation_position,version=version+1,updated_by=p_actor_id,updated_at=now() where singleton;
  insert into public.audit_events(actor_id,actor_kind,entity_type,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','campsite_rotation','campsite_rotation_reordered',p_reason,p_request_id,extensions.digest(convert_to(to_jsonb(p_order)::text,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
end $$;

create function public.phase2_admin_update_campsite(p_actor_id uuid,p_campsite_id uuid,p_input jsonb,p_reason text,p_request_id uuid)
returns integer language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_expected integer; v_version integer;
begin
  perform private.phase2_require_admin(p_actor_id);
  if jsonb_typeof(p_input)<>'object' or p_reason is null or length(btrim(p_reason))=0 or p_request_id is null then raise exception 'invalid campsite update'; end if;
  v_expected:=(p_input->>'expectedVersion')::integer;
  update public.campsites set name=btrim(p_input->>'name'),availability_url=nullif(p_input->>'availabilityUrl',''),
    location_description=coalesce(p_input->>'locationDescription',''),directions=nullif(p_input->>'directions',''),
    cabin_capacity=nullif(p_input->>'cabinCapacity','')::integer,cabin_types=coalesce(p_input->'cabinTypes','[]'::jsonb),
    reservation_instructions=nullif(p_input->>'reservationInstructions',''),estimated_rate_cents=nullif(p_input->>'estimatedRateCents','')::bigint,
    availability_status=p_input->>'availabilityStatus',availability_source_url=nullif(p_input->>'availabilitySourceUrl',''),
    availability_verified_at=nullif(p_input->>'availabilityVerifiedAt','')::timestamptz,
    updated_by=p_actor_id,updated_at=now(),version=version+1
  where id=p_campsite_id and version=v_expected returning version into v_version;
  if not found then raise exception 'campsite not found or stale version' using errcode='40001'; end if;
  insert into private.campsite_admin_notes(campsite_id,admin_notes,updated_by,updated_at)
    values(p_campsite_id,coalesce(p_input->>'adminNotes',''),p_actor_id,now())
    on conflict(campsite_id) do update set admin_notes=excluded.admin_notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','campsite',p_campsite_id,'campsite_updated',p_reason,p_request_id,extensions.digest(convert_to(p_input::text,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
  return v_version;
end $$;

create function public.phase2_admin_configure_trip(
  p_actor_id uuid,p_trip_id uuid,p_starts_on date,p_ends_on date,p_deadline_date date,p_deadline_time time,
  p_minimum_participants integer,p_max_capacity integer,p_selected_campsite_id uuid,p_availability_status text,
  p_additional_information text,p_expected_version integer,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_trip public.camping_trips%rowtype; v_config public.club_configuration%rowtype; v_deadline_date date; v_deadline_time time; v_deadline timestamptz; v_trip_timezone text; v_old_site uuid;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on or p_minimum_participants not between 1 and 100
    or (p_max_capacity is not null and p_max_capacity<p_minimum_participants)
    or p_availability_status not in ('available','limited','unavailable','unknown','manual_confirmation')
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
  v_old_site:=v_trip.selected_campsite_id;
  update public.camping_trips set starts_on=p_starts_on,ends_on=p_ends_on,club_timezone_snapshot=v_trip_timezone,
    poll_deadline_at=v_deadline,minimum_participants=p_minimum_participants,max_capacity=p_max_capacity,
    selected_campsite_id=p_selected_campsite_id,cabin_availability_status=p_availability_status,
    additional_information=coalesce(p_additional_information,''),updated_by=p_actor_id,updated_at=now(),version=version+1
    where id=p_trip_id returning * into v_trip;
  if p_selected_campsite_id<>v_old_site then
    insert into public.trip_poll_events(trip_id,actor_id,event_type,request_id,reason,event_details)
      values(p_trip_id,p_actor_id,'campsite_overridden',p_request_id,p_reason,jsonb_build_object('suggested_campsite_id',v_trip.suggested_campsite_id,'selected_campsite_id',p_selected_campsite_id));
  end if;
  insert into public.trip_poll_events(trip_id,actor_id,event_type,request_id,reason,event_details)
    values(p_trip_id,p_actor_id,'trip_configured',p_request_id,p_reason,jsonb_build_object('starts_on',p_starts_on,'ends_on',p_ends_on,'poll_deadline_at',v_deadline,'minimum_participants',p_minimum_participants,'version',v_trip.version));
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','camping_trip',p_trip_id,'interest_poll_configured',p_reason,p_request_id,extensions.digest(convert_to(to_jsonb(v_trip)::text,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
  return jsonb_build_object('tripId',p_trip_id,'version',v_trip.version,'pollDeadlineAt',v_deadline,'minimumBasis',null);
end $$;

create function public.phase2_admin_set_poll_status(p_actor_id uuid,p_trip_id uuid,p_status text,p_expected_version integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_trip public.camping_trips%rowtype; v_bundle uuid; v_from_status text;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_status not in ('open','closed') or p_reason is null or length(btrim(p_reason))=0 or p_request_id is null then raise exception 'invalid poll transition'; end if;
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found then raise exception 'poll not found'; end if;
  if v_trip.version<>p_expected_version then raise exception 'stale poll version' using errcode='40001'; end if;
  v_from_status:=v_trip.poll_status;
  if p_status='open' then
    if v_trip.poll_status not in ('draft','closed') then raise exception 'poll is already open'; end if;
    if v_trip.starts_on is null or v_trip.ends_on is null or v_trip.club_timezone_snapshot is null or v_trip.poll_deadline_at is null or v_trip.poll_deadline_at<=now() then raise exception 'poll dates, timezone and future deadline are required'; end if;
    select id into v_bundle from public.trip_rule_bundles where trip_id=p_trip_id and is_current;
    if v_bundle is null then raise exception 'current Camping Constitution bundle is required'; end if;
    perform private.phase2_build_rule_bundle(p_trip_id,p_actor_id);
  else
    if v_trip.poll_status<>'open' then raise exception 'only an open poll can be closed'; end if;
  end if;
  update public.camping_trips set poll_status=p_status,version=version+1,updated_by=p_actor_id,updated_at=now() where id=p_trip_id returning * into v_trip;
  insert into public.trip_poll_events(trip_id,actor_id,event_type,from_status,to_status,request_id,reason,event_details)
    values(p_trip_id,p_actor_id,case when p_status='open' and v_from_status='closed' then 'poll_reopened' when p_status='open' then 'poll_opened' else 'poll_closed' end,
      v_from_status,p_status,p_request_id,p_reason,jsonb_build_object('minimum_basis',null,'decision_effect','none'));
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','camping_trip',p_trip_id,'interest_poll_'||p_status,p_reason,p_request_id,extensions.digest(convert_to(p_status||':'||v_trip.version,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
  return jsonb_build_object('tripId',p_trip_id,'pollStatus',p_status,'version',v_trip.version,'tripDecision','none');
end $$;

create function public.phase2_admin_publish_rule(
  p_actor_id uuid,p_scope text,p_trip_id uuid,p_stable_key text,p_category text,p_human_text text,
  p_structured_values jsonb,p_effective_from timestamptz,p_expires_at timestamptz,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private,extensions as $$
declare v_definition public.rule_definitions%rowtype; v_version_id uuid; v_version_no integer; v_trip record; v_bundles integer:=0;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_scope not in ('general','trip') or p_category not in ('participation','transport','cabin','expenses','lodging','meals','conduct','custom')
    or p_stable_key !~ '^[a-z0-9][a-z0-9_-]{1,79}$' or p_human_text is null or length(btrim(p_human_text)) not between 1 and 8000
    or jsonb_typeof(p_structured_values)<>'object' or octet_length(p_structured_values::text)>16000
    or p_effective_from is null or (p_expires_at is not null and p_expires_at<=p_effective_from)
    or (p_scope='trip' and (p_trip_id is null or p_expires_at is null or p_expires_at<=now()))
    or (p_scope='general' and p_trip_id is not null) or p_reason is null or length(btrim(p_reason))=0 or p_request_id is null then
    raise exception 'invalid rule version';
  end if;
  select * into v_definition from public.rule_definitions where stable_key=p_stable_key and scope=p_scope and trip_id is not distinct from p_trip_id for update;
  if not found then
    insert into public.rule_definitions(stable_key,category,scope,trip_id,created_by) values(p_stable_key,p_category,p_scope,p_trip_id,p_actor_id) returning * into v_definition;
  elsif v_definition.category<>p_category then raise exception 'rule category cannot change between versions'; end if;
  select coalesce(max(version_no),0)+1 into v_version_no from public.rule_versions where definition_id=v_definition.id;
  insert into public.rule_versions(definition_id,version_no,human_text,structured_values,effective_from,expires_at,created_by)
    values(v_definition.id,v_version_no,btrim(p_human_text),p_structured_values,p_effective_from,p_expires_at,p_actor_id) returning id into v_version_id;
  for v_trip in select id from public.camping_trips where month_key>=date_trunc('month',current_date)::date and poll_status in ('draft','open') and (p_scope='general' or id=p_trip_id) order by month_key loop
    perform private.phase2_build_rule_bundle(v_trip.id,p_actor_id);
    v_bundles:=v_bundles+1;
  end loop;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','rule_version',v_version_id,'rule_version_published',p_reason,p_request_id,extensions.digest(convert_to(jsonb_build_object('stable_key',p_stable_key,'version',v_version_no,'text',p_human_text,'values',p_structured_values)::text,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
  return jsonb_build_object('ruleVersionId',v_version_id,'version',v_version_no,'bundlesUpdated',v_bundles);
end $$;

create function public.phase2_admin_set_rule_override(
  p_actor_id uuid,p_trip_id uuid,p_base_rule_version_id uuid,p_human_text text,p_structured_values jsonb,
  p_expires_at timestamptz,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private,extensions as $$
declare v_definition uuid; v_current_version uuid; v_version integer; v_override uuid; v_bundle uuid;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_human_text is null or length(btrim(p_human_text)) not between 1 and 8000 or jsonb_typeof(p_structured_values)<>'object'
    or octet_length(p_structured_values::text)>16000 or p_expires_at<=now() or p_reason is null or length(btrim(p_reason))=0 or p_request_id is null then
    raise exception 'invalid trip override';
  end if;
  select d.id into v_definition from public.rule_versions rv join public.rule_definitions d on d.id=rv.definition_id
    where rv.id=p_base_rule_version_id and d.scope='general' and d.active and rv.effective_from<=now() and (rv.expires_at is null or rv.expires_at>now());
  if v_definition is null then raise exception 'override must link to an active general rule version'; end if;
  select rv.id into v_current_version from public.rule_versions rv where rv.definition_id=v_definition and rv.effective_from<=now() and (rv.expires_at is null or rv.expires_at>now()) order by rv.effective_from desc,rv.version_no desc limit 1;
  if v_current_version<>p_base_rule_version_id then raise exception 'override must reference the current general rule version'; end if;
  perform 1 from public.camping_trips where id=p_trip_id for update;
  if not found then raise exception 'trip poll not found'; end if;
  update public.trip_rule_overrides set retired_at=now() where trip_id=p_trip_id and general_rule_definition_id=v_definition and retired_at is null;
  select coalesce(max(version_no),0)+1 into v_version from public.trip_rule_overrides where trip_id=p_trip_id and general_rule_definition_id=v_definition;
  insert into public.trip_rule_overrides(trip_id,general_rule_definition_id,base_rule_version_id,version_no,human_text,structured_values,expires_at,reason,created_by)
    values(p_trip_id,v_definition,p_base_rule_version_id,v_version,btrim(p_human_text),p_structured_values,p_expires_at,btrim(p_reason),p_actor_id) returning id into v_override;
  v_bundle:=private.phase2_build_rule_bundle(p_trip_id,p_actor_id);
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id,after_hash)
    values(p_actor_id,'admin','trip_rule_override',v_override,'trip_rule_override_created',p_reason,p_request_id,extensions.digest(convert_to(jsonb_build_object('trip_id',p_trip_id,'base_rule_version_id',p_base_rule_version_id,'override_id',v_override,'bundle_id',v_bundle)::text,'UTF8'),'sha256'))
    on conflict(actor_id,request_id) do nothing;
  return jsonb_build_object('overrideId',v_override,'bundleId',v_bundle,'version',v_version);
end $$;

create function public.phase2_submit_rsvp(
  p_auth_user_id uuid,p_trip_id uuid,p_response text,p_bundle_id uuid,p_content_hash text,p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_member uuid; v_trip public.camping_trips%rowtype; v_old public.trip_rsvps%rowtype; v_ack uuid; v_current_bundle public.trip_rule_bundles%rowtype; v_id uuid; v_version integer; v_event text; v_existing boolean;
begin
  if p_auth_user_id is null or p_response not in ('coming','not_coming') or p_request_id is null then raise exception 'invalid RSVP'; end if;
  select member_id into v_member from public.member_profiles where auth_user_id=p_auth_user_id and account_status='active' and member_role in ('member','admin');
  if not found then raise exception 'active member required' using errcode='42501'; end if;
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found then raise exception 'poll not found'; end if;
  if v_trip.poll_status<>'open' or v_trip.poll_deadline_at<=now() then raise exception 'interest poll is closed'; end if;
  if p_response='coming' and (not exists(select 1 from public.trip_rsvps where trip_id=p_trip_id and member_id=v_member and response='coming')) then
    perform private.phase2_build_rule_bundle(p_trip_id,v_member);
  end if;
  select * into v_old from public.trip_rsvps where trip_id=p_trip_id and member_id=v_member for update;
  v_existing:=found;
  if v_existing then
    if p_expected_version is null or p_expected_version<>v_old.version then raise exception 'stale RSVP version' using errcode='40001'; end if;
    v_id:=v_old.id;
    v_version:=v_old.version+1;
    v_ack:=v_old.rule_acknowledgment_id;
  else
    if coalesce(p_expected_version,0)<>0 then raise exception 'stale RSVP version' using errcode='40001'; end if;
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
  return jsonb_build_object('rsvpId',v_id,'response',p_response,'version',v_version,'acknowledgmentId',v_ack);
end $$;

create function public.phase2_admin_record_interest(
  p_actor_id uuid,p_trip_id uuid,p_member_id uuid,p_response text,p_expected_version integer,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_trip public.camping_trips%rowtype; v_old public.trip_rsvps%rowtype; v_member public.member_profiles%rowtype; v_bundle uuid; v_ack uuid; v_id uuid; v_version integer;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_response not in ('coming','not_coming') or p_reason is null or length(btrim(p_reason))=0 or p_request_id is null then raise exception 'invalid administrator poll entry'; end if;
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found or v_trip.poll_status<>'open' or v_trip.poll_deadline_at<=now() then raise exception 'interest poll is closed'; end if;
  select * into v_member from public.member_profiles where member_id=p_member_id and account_status='active';
  if not found then raise exception 'active member required'; end if;
  if p_response='coming' and not exists(select 1 from public.trip_rsvps where trip_id=p_trip_id and member_id=p_member_id and response='coming') then
    perform private.phase2_build_rule_bundle(p_trip_id,p_actor_id);
  end if;
  select * into v_old from public.trip_rsvps where trip_id=p_trip_id and member_id=p_member_id for update;
  if found then
    if p_expected_version is null or v_old.version<>p_expected_version then raise exception 'stale RSVP version' using errcode='40001'; end if;
    v_id:=v_old.id; v_version:=v_old.version+1; v_ack:=v_old.rule_acknowledgment_id;
  else
    if coalesce(p_expected_version,0)<>0 then raise exception 'stale RSVP version' using errcode='40001'; end if;
    v_id:=gen_random_uuid(); v_version:=1;
  end if;
  if p_response='coming' then
    select id into v_bundle from public.trip_rule_bundles where trip_id=p_trip_id and is_current;
    if v_old.rule_acknowledgment_id is not null and v_old.response='coming' then
      v_ack:=v_old.rule_acknowledgment_id;
    else
      select id into v_ack from public.trip_rule_acknowledgments where member_id=p_member_id and trip_id=p_trip_id and bundle_id=v_bundle and statement_version='coming-v1';
      if v_ack is null then raise exception 'member must personally acknowledge the current rule bundle'; end if;
    end if;
    if v_trip.max_capacity is not null and (v_old.id is null or v_old.response<>'coming')
      and (select count(*) from public.trip_rsvps where trip_id=p_trip_id and response='coming')>=v_trip.max_capacity then raise exception 'interest poll capacity reached'; end if;
  end if;
  if v_old.id is null then
    insert into public.trip_rsvps(id,trip_id,member_id,response,rule_acknowledgment_id,version) values(v_id,p_trip_id,p_member_id,p_response,v_ack,v_version);
  else
    update public.trip_rsvps set response=p_response,rule_acknowledgment_id=v_ack,version=v_version,updated_at=now() where id=v_id;
  end if;
  insert into public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
    values(p_trip_id,p_member_id,p_actor_id,'admin_interest_recorded',v_old.response,p_response,v_ack,p_request_id,p_reason);
  return jsonb_build_object('rsvpId',v_id,'response',p_response,'version',v_version);
end $$;

create function public.phase2_request_withdrawal(p_auth_user_id uuid,p_trip_id uuid,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_member uuid; v_trip public.camping_trips%rowtype; v_rsvp public.trip_rsvps%rowtype; v_request uuid;
begin
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_request_id is null then raise exception 'a withdrawal reason is required'; end if;
  select member_id into v_member from public.member_profiles where auth_user_id=p_auth_user_id and account_status='active';
  if not found then raise exception 'active member required' using errcode='42501'; end if;
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found then raise exception 'poll not found'; end if;
  select * into v_rsvp from public.trip_rsvps where trip_id=p_trip_id and member_id=v_member for update;
  if not found or v_rsvp.response<>'coming' then raise exception 'only a Coming response can be withdrawn'; end if;
  if v_trip.poll_status='open' and v_trip.poll_deadline_at>now() then
    update public.trip_rsvps set response='not_coming',version=version+1,updated_at=now() where id=v_rsvp.id returning * into v_rsvp;
    insert into public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
      values(p_trip_id,v_member,v_member,'changed','coming','not_coming',v_rsvp.rule_acknowledgment_id,p_request_id,btrim(p_reason));
    return jsonb_build_object('state','withdrawn_from_interest_poll','response','not_coming','version',v_rsvp.version);
  end if;
  insert into public.trip_withdrawal_requests(trip_id,member_id,reason,request_id) values(p_trip_id,v_member,btrim(p_reason),p_request_id) returning id into v_request;
  insert into public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
    values(p_trip_id,v_member,v_member,'withdrawal_requested','coming','coming',v_rsvp.rule_acknowledgment_id,p_request_id,btrim(p_reason));
  return jsonb_build_object('state','pending_owner_policy','requestId',v_request,'response','coming');
end $$;

create or replace function private.phase2_replenish_calendar_job()
returns void language sql security invoker set search_path=pg_catalog,public as $$
  select public.phase2_generate_calendar(null,(date_trunc('month',current_date)::date+interval '12 months')::date,gen_random_uuid());
$$;

select cron.schedule('phase2-replenish-calendar','5 0 1 * *','select private.phase2_replenish_calendar_job();');
select cron.schedule('phase2-close-interest-polls','*/5 * * * *','select public.phase2_close_due_polls();');
select public.phase2_generate_calendar(null,(date_trunc('month',current_date)::date+interval '12 months')::date,gen_random_uuid());

revoke all on function private.phase2_require_admin(uuid) from public,anon,authenticated;
revoke all on function private.phase2_build_rule_bundle(uuid,uuid) from public,anon,authenticated;
revoke all on function public.phase2_refresh_open_rule_bundles(uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.phase2_admin_get_campsite_notes(uuid) from public,anon,authenticated,service_role;
revoke all on function private.phase2_replenish_calendar_job() from public,anon,authenticated,service_role;
revoke all on function public.phase2_generate_calendar(uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.phase2_close_due_polls() from public,anon,authenticated,service_role;
revoke all on function public.phase2_configure_club(uuid,text,integer,time,integer,integer,integer,uuid) from public,anon,authenticated;
revoke all on function public.phase2_admin_reorder_campsites(uuid,uuid[],integer,text,uuid) from public,anon,authenticated;
revoke all on function public.phase2_admin_update_campsite(uuid,uuid,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.phase2_admin_set_poll_status(uuid,uuid,text,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.phase2_admin_publish_rule(uuid,text,uuid,text,text,text,jsonb,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.phase2_admin_set_rule_override(uuid,uuid,uuid,text,jsonb,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.phase2_submit_rsvp(uuid,uuid,text,uuid,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.phase2_admin_record_interest(uuid,uuid,uuid,text,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.phase2_request_withdrawal(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.phase2_generate_calendar(uuid,date,uuid),
  public.phase2_admin_get_campsite_notes(uuid),
  public.phase2_configure_club(uuid,text,integer,time,integer,integer,integer,uuid),
  public.phase2_admin_reorder_campsites(uuid,uuid[],integer,text,uuid),
  public.phase2_admin_update_campsite(uuid,uuid,jsonb,text,uuid),
  public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid),
  public.phase2_admin_set_poll_status(uuid,uuid,text,integer,text,uuid),
  public.phase2_admin_publish_rule(uuid,text,uuid,text,text,text,jsonb,timestamptz,timestamptz,text,uuid),
  public.phase2_admin_set_rule_override(uuid,uuid,uuid,text,jsonb,timestamptz,text,uuid),
  public.phase2_submit_rsvp(uuid,uuid,text,uuid,text,integer,uuid),
  public.phase2_refresh_open_rule_bundles(uuid,uuid[]),
  public.phase2_admin_record_interest(uuid,uuid,uuid,text,integer,text,uuid),
  public.phase2_request_withdrawal(uuid,uuid,text,uuid) to service_role;
grant execute on function private.phase2_require_admin(uuid),private.phase2_build_rule_bundle(uuid,uuid) to service_role;
grant execute on function public.phase2_refresh_open_rule_bundles(uuid,uuid[]) to service_role;
