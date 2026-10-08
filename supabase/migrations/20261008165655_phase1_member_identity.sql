-- Phase 1 identity baseline. Financial and trip policy is intentionally out of scope.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.member_profiles (
  member_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  member_role text not null default 'member' check (member_role in ('member','admin')),
  account_status text not null default 'active' check (account_status in ('active','inactive','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint member_profile_auth_required unique (member_id, auth_user_id)
);
create index member_profiles_active_role_idx on public.member_profiles(member_role) where account_status = 'active';
create index member_profiles_status_idx on public.member_profiles(account_status);

create table public.member_private_contacts (
  member_id uuid primary key references public.member_profiles(member_id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz not null default now()
);

create table public.member_payment_methods (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.member_profiles(member_id) on delete cascade,
  method text not null check (method in ('zelle','venmo','paypal','apple_cash')),
  preferred boolean not null default false,
  accepted_for_receiving boolean not null default true,
  active boolean not null default true,
  verified_format_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index member_payment_methods_one_preferred_idx on public.member_payment_methods(member_id) where preferred and active;
create index member_payment_methods_member_idx on public.member_payment_methods(member_id, active);

create table private.member_payment_identifiers (
  payment_method_id uuid primary key references public.member_payment_methods(id) on delete cascade,
  identifier_ciphertext bytea not null,
  nonce bytea not null check (octet_length(nonce) = 12),
  encryption_key_version text not null,
  fingerprint_hmac bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delete_after timestamptz,
  deleted_at timestamptz
);

create table private.admin_invitation_events (
  id uuid primary key default gen_random_uuid(),
  email_hmac bytea not null,
  invited_by uuid references public.member_profiles(member_id) on delete set null,
  auth_invite_id uuid,
  requested_role text not null default 'member' check (requested_role in ('member','admin')),
  is_bootstrap boolean not null default false,
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked','failed')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz not null,
  constraint admin_invitation_expiry check (expires_at > created_at)
);
create unique index one_pending_invitation_per_email on private.admin_invitation_events(email_hmac) where status = 'pending';
create unique index one_bootstrap_admin_invitation on private.admin_invitation_events(is_bootstrap) where is_bootstrap and status in ('pending','accepted');

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.member_profiles(member_id) on delete set null,
  actor_kind text not null check (actor_kind in ('member','admin','system')),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  reason text,
  before_hash bytea,
  after_hash bytea,
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique(actor_id, request_id)
);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id, created_at desc);
create index audit_events_actor_idx on public.audit_events(actor_id, created_at desc);

create table public.application_settings (
  stable_key text primary key,
  typed_value jsonb not null,
  is_public boolean not null default false,
  changed_by uuid references public.member_profiles(member_id) on delete set null,
  changed_at timestamptz not null default now(),
  description text not null
);

create table private.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  principal_scope text not null,
  operation_key text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  key_hmac bytea not null,
  hmac_key_version text not null,
  canonical_request_hash bytea not null,
  result_entity_id uuid,
  result_code text,
  status text not null default 'processing' check (status in ('processing','completed')),
  lease_expires_at timestamptz not null default (now() + interval '2 minutes'),
  replay_expires_at timestamptz not null,
  tombstone_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(principal_scope, operation_key, aggregate_type, aggregate_id, hmac_key_version, key_hmac)
);
create index idempotency_tombstone_idx on private.idempotency_records(tombstone_expires_at) where tombstone_expires_at is not null;

create table private.bootstrap_control (
  singleton boolean primary key default true check (singleton),
  consumed_at timestamptz,
  reserved_invitation_id uuid references private.admin_invitation_events(id),
  reserved_at timestamptz
);
insert into private.bootstrap_control(singleton) values (true);

create function public.phase1_begin_idempotency(p_principal text,p_operation text,p_aggregate uuid,p_key_hmac bytea,p_hmac_key_version text,p_request_hash bytea)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, private as $$
declare v_record private.idempotency_records%rowtype; v_inserted uuid;
begin
  insert into private.idempotency_records(principal_scope,operation_key,aggregate_type,aggregate_id,key_hmac,hmac_key_version,canonical_request_hash,result_code,replay_expires_at)
  values(p_principal,p_operation,'phase1',p_aggregate,p_key_hmac,p_hmac_key_version,p_request_hash,null,now()+interval '30 days')
  on conflict(principal_scope,operation_key,aggregate_type,aggregate_id,hmac_key_version,key_hmac) do nothing returning id into v_inserted;
  if v_inserted is not null then return jsonb_build_object('state','started'); end if;
  select * into v_record from private.idempotency_records where principal_scope=p_principal and operation_key=p_operation and aggregate_type='phase1' and aggregate_id=p_aggregate and hmac_key_version=p_hmac_key_version and key_hmac=p_key_hmac for update;
  if v_record.canonical_request_hash <> p_request_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
  if v_record.replay_expires_at <= now() then raise exception 'idempotency replay expired' using errcode='22023'; end if;
  if v_record.status='completed' then return jsonb_build_object('state','replay','resultId',v_record.result_entity_id,'resultCode',v_record.result_code); end if;
  if v_record.lease_expires_at <= now() then
    update private.idempotency_records set lease_expires_at=now()+interval '2 minutes' where id=v_record.id;
    return jsonb_build_object('state','started');
  end if;
  return jsonb_build_object('state','in_progress');
end $$;

create function public.phase1_finish_idempotency(p_principal text,p_operation text,p_aggregate uuid,p_key_hmac bytea,p_hmac_key_version text,p_request_hash bytea,p_result_id uuid,p_result_code text)
returns void language plpgsql security invoker set search_path = pg_catalog, private as $$
begin
  update private.idempotency_records set status='completed',result_entity_id=p_result_id,result_code=p_result_code,lease_expires_at='infinity'
   where principal_scope=p_principal and operation_key=p_operation and aggregate_type='phase1' and aggregate_id=p_aggregate and key_hmac=p_key_hmac and hmac_key_version=p_hmac_key_version and canonical_request_hash=p_request_hash and status='processing';
  if not found then raise exception 'idempotency claim missing'; end if;
end $$;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin new.updated_at := now(); return new; end $$;
create trigger member_profiles_touch before update on public.member_profiles for each row execute function public.touch_updated_at();
create trigger member_contacts_touch before update on public.member_private_contacts for each row execute function public.touch_updated_at();
create trigger payment_methods_touch before update on public.member_payment_methods for each row execute function public.touch_updated_at();

create function public.reject_audit_mutation() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin raise exception 'audit events are append-only' using errcode = '55000'; end $$;
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function public.reject_audit_mutation();

alter table public.member_profiles enable row level security;
alter table public.member_private_contacts enable row level security;
alter table public.member_payment_methods enable row level security;
alter table public.audit_events enable row level security;
alter table public.application_settings enable row level security;
alter table private.member_payment_identifiers enable row level security;
alter table private.admin_invitation_events enable row level security;
alter table private.idempotency_records enable row level security;
alter table private.bootstrap_control enable row level security;

revoke all on public.member_profiles, public.member_private_contacts, public.member_payment_methods,
  public.audit_events, public.application_settings from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
grant select on public.member_profiles, public.member_private_contacts, public.member_payment_methods,
  public.application_settings to authenticated;
grant update(display_name) on public.member_profiles to authenticated;
grant insert(phone_e164), update(phone_e164) on public.member_private_contacts to authenticated;
grant insert(member_id, method, preferred, accepted_for_receiving, active),
  update(method, preferred, accepted_for_receiving, active) on public.member_payment_methods to authenticated;
grant select on public.application_settings to anon;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy member_profiles_read_self on public.member_profiles for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy member_profiles_update_self on public.member_profiles for update to authenticated
  using (auth_user_id = (select auth.uid()) and account_status = 'active')
  with check (auth_user_id = (select auth.uid()) and account_status = 'active');
create policy contacts_self on public.member_private_contacts for all to authenticated
  using (exists (select 1 from public.member_profiles p where p.member_id = member_private_contacts.member_id and p.auth_user_id = (select auth.uid()) and p.account_status = 'active'))
  with check (exists (select 1 from public.member_profiles p where p.member_id = member_private_contacts.member_id and p.auth_user_id = (select auth.uid()) and p.account_status = 'active'));
create policy payment_methods_self on public.member_payment_methods for all to authenticated
  using (exists (select 1 from public.member_profiles p where p.member_id = member_payment_methods.member_id and p.auth_user_id = (select auth.uid()) and p.account_status = 'active'))
  with check (exists (select 1 from public.member_profiles p where p.member_id = member_payment_methods.member_id and p.auth_user_id = (select auth.uid()) and p.account_status = 'active'));
create policy public_settings_read on public.application_settings for select to anon, authenticated
  using (is_public);
create policy active_member_settings_read on public.application_settings for select to authenticated
  using (is_public and exists (select 1 from public.member_profiles p where p.auth_user_id = (select auth.uid()) and p.account_status = 'active'));

-- Trusted RPCs are callable only with the service_role JWT used by Edge Functions.
create function public.phase1_reserve_bootstrap_invitation(p_email_hmac bytea, p_auth_invite_id uuid, p_expires_at timestamptz)
returns uuid language plpgsql security invoker set search_path = pg_catalog, public, private as $$
declare v_invitation uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '14 days' then raise exception 'invalid invitation expiry'; end if;
  perform 1 from private.bootstrap_control where singleton for update;
  if exists(select 1 from public.member_profiles where member_role='admin' and account_status='active') then raise exception 'an active administrator already exists'; end if;
  if exists(select 1 from private.bootstrap_control where singleton and consumed_at is not null) then raise exception 'bootstrap already consumed'; end if;
  if exists(select 1 from private.bootstrap_control where singleton and reserved_at > now() - interval '24 hours') then raise exception 'bootstrap already reserved'; end if;
  update private.admin_invitation_events set status='expired'
    where id=(select reserved_invitation_id from private.bootstrap_control where singleton) and status='pending';
  update private.bootstrap_control set reserved_invitation_id=null,reserved_at=null where singleton;
  insert into private.admin_invitation_events(email_hmac, auth_invite_id, requested_role, is_bootstrap, expires_at)
    values(p_email_hmac, p_auth_invite_id, 'admin', true, p_expires_at) returning id into v_invitation;
  update private.bootstrap_control set reserved_invitation_id = v_invitation, reserved_at = now() where singleton;
  return v_invitation;
end $$;

create function public.phase1_create_invitation(p_email_hmac bytea, p_actor_id uuid, p_auth_invite_id uuid, p_expires_at timestamptz, p_request_id uuid)
returns uuid language plpgsql security invoker set search_path = pg_catalog, public, private as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.member_profiles where member_id = p_actor_id and member_role = 'admin' and account_status = 'active') then raise exception 'administrator required' using errcode='42501'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '14 days' then raise exception 'invalid invitation expiry'; end if;
  update private.admin_invitation_events set status='expired' where email_hmac=p_email_hmac and status='pending' and expires_at <= now();
  insert into private.admin_invitation_events(email_hmac, invited_by, auth_invite_id, expires_at)
    values(p_email_hmac,p_actor_id,p_auth_invite_id,p_expires_at) returning id into v_id;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,request_id)
    values(p_actor_id,'admin','invitation',v_id,'member_invited',p_request_id) on conflict(actor_id,request_id) do nothing;
  return v_id;
end $$;

create function public.phase1_complete_invited_profile(
  p_auth_user_id uuid, p_email_hmac bytea, p_display_name text, p_phone_e164 text,
  p_method text, p_ciphertext bytea, p_nonce bytea, p_key_version text, p_fingerprint bytea, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path = pg_catalog, public, private as $$
declare v_inv private.admin_invitation_events%rowtype; v_member uuid; v_role text;
begin
  if p_auth_user_id is null or length(btrim(p_display_name)) not between 1 and 80 then raise exception 'invalid profile'; end if;
  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid phone'; end if;
  if p_method not in ('zelle','venmo','paypal','apple_cash') or octet_length(p_nonce) <> 12 or octet_length(p_ciphertext) < 17 then raise exception 'invalid payment preference'; end if;
  select * into v_inv from private.admin_invitation_events where email_hmac=p_email_hmac and status='pending' and expires_at > now() for update;
  if not found then raise exception 'valid invitation required' using errcode='42501'; end if;
  if exists(select 1 from public.member_profiles where auth_user_id=p_auth_user_id) then raise exception 'profile already exists'; end if;
  v_role := v_inv.requested_role;
  if v_inv.is_bootstrap then
    perform 1 from private.bootstrap_control where singleton and reserved_invitation_id=v_inv.id and consumed_at is null for update;
    if not found then raise exception 'bootstrap reservation is invalid'; end if;
  end if;
  insert into public.member_profiles(auth_user_id,display_name,member_role,account_status)
    values(p_auth_user_id,btrim(p_display_name),v_role,'active') returning member_id into v_member;
  insert into public.member_private_contacts(member_id,phone_e164) values(v_member,p_phone_e164);
  insert into public.member_payment_methods(member_id,method,preferred,accepted_for_receiving,active)
    values(v_member,p_method,true,true,true) returning id into v_inv.auth_invite_id;
  insert into private.member_payment_identifiers(payment_method_id,identifier_ciphertext,nonce,encryption_key_version,fingerprint_hmac)
    values(v_inv.auth_invite_id,p_ciphertext,p_nonce,p_key_version,p_fingerprint);
  update private.admin_invitation_events set status='accepted',accepted_at=now() where id=v_inv.id;
  if v_inv.is_bootstrap then update private.bootstrap_control set consumed_at=now(),reserved_invitation_id=null,reserved_at=null where singleton; end if;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,request_id)
    values(v_member,case when v_role='admin' then 'admin' else 'member' end,'member',v_member,case when v_role='admin' then 'bootstrap_admin_activated' else 'member_activated' end,p_request_id)
    on conflict(actor_id,request_id) do nothing;
  return v_member;
end $$;

create function public.phase1_update_membership(p_actor_id uuid, p_target_member_id uuid, p_role text, p_status text, p_reason text, p_request_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_old_role text; v_old_status text;
begin
  if not exists(select 1 from public.member_profiles where member_id=p_actor_id and member_role='admin' and account_status='active') then raise exception 'administrator required' using errcode='42501'; end if;
  if p_role not in ('member','admin') or p_status not in ('active','inactive','suspended') then raise exception 'invalid membership state'; end if;
  if p_reason is null or length(btrim(p_reason))=0 then raise exception 'a reason is required'; end if;
  select member_role, account_status into v_old_role,v_old_status from public.member_profiles where member_id=p_target_member_id for update;
  if not found then raise exception 'member not found'; end if;
  if v_old_role='admin' and v_old_status='active' and (p_role <> 'admin' or p_status <> 'active') and
     (select count(*) from public.member_profiles where member_role='admin' and account_status='active') <= 1 then raise exception 'cannot deactivate the last active administrator'; end if;
  update public.member_profiles set member_role=p_role, account_status=p_status, deactivated_at=case when p_status='inactive' then coalesce(deactivated_at,now()) else null end where member_id=p_target_member_id;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id)
    values(p_actor_id,'admin','member',p_target_member_id,'membership_changed',p_reason,p_request_id) on conflict(actor_id,request_id) do nothing;
end $$;

create function public.phase1_update_own_profile(
  p_auth_user_id uuid, p_display_name text, p_phone_e164 text, p_method text,
  p_ciphertext bytea, p_nonce bytea, p_key_version text, p_fingerprint bytea, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path = pg_catalog, public, private as $$
declare v_member uuid; v_method_id uuid;
begin
  if length(btrim(p_display_name)) not between 1 and 80 or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid profile'; end if;
  if p_method not in ('zelle','venmo','paypal','apple_cash') or octet_length(p_nonce) <> 12 or octet_length(p_ciphertext) < 17 then raise exception 'invalid payment preference'; end if;
  select member_id into v_member from public.member_profiles where auth_user_id=p_auth_user_id and account_status='active' for update;
  if not found then raise exception 'active member required' using errcode='42501'; end if;
  update public.member_profiles set display_name=btrim(p_display_name) where member_id=v_member;
  insert into public.member_private_contacts(member_id,phone_e164) values(v_member,p_phone_e164)
    on conflict(member_id) do update set phone_e164=excluded.phone_e164;
  select id into v_method_id from public.member_payment_methods where member_id=v_member and preferred and active for update;
  if found then
    update public.member_payment_methods set method=p_method where id=v_method_id;
    update private.member_payment_identifiers set identifier_ciphertext=p_ciphertext,nonce=p_nonce,encryption_key_version=p_key_version,fingerprint_hmac=p_fingerprint,updated_at=now(),deleted_at=null,delete_after=null where payment_method_id=v_method_id;
    if not found then insert into private.member_payment_identifiers(payment_method_id,identifier_ciphertext,nonce,encryption_key_version,fingerprint_hmac) values(v_method_id,p_ciphertext,p_nonce,p_key_version,p_fingerprint); end if;
  else
    insert into public.member_payment_methods(member_id,method,preferred,accepted_for_receiving,active)
      values(v_member,p_method,true,true,true) returning id into v_method_id;
    insert into private.member_payment_identifiers(payment_method_id,identifier_ciphertext,nonce,encryption_key_version,fingerprint_hmac)
      values(v_method_id,p_ciphertext,p_nonce,p_key_version,p_fingerprint);
  end if;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,request_id)
    values(v_member,'member','member',v_member,'profile_updated',p_request_id) on conflict(actor_id,request_id) do nothing;
  return v_method_id;
end $$;

revoke all on function public.phase1_reserve_bootstrap_invitation(bytea,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.phase1_create_invitation(bytea,uuid,uuid,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.phase1_complete_invited_profile(uuid,bytea,text,text,text,bytea,bytea,text,bytea,uuid) from public, anon, authenticated;
revoke all on function public.phase1_update_membership(uuid,uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.phase1_update_own_profile(uuid,text,text,text,bytea,bytea,text,bytea,uuid) from public, anon, authenticated;
revoke all on function public.phase1_begin_idempotency(text,text,uuid,bytea,text,bytea) from public, anon, authenticated;
revoke all on function public.phase1_finish_idempotency(text,text,uuid,bytea,text,bytea,uuid,text) from public, anon, authenticated;
grant execute on function public.phase1_reserve_bootstrap_invitation(bytea,uuid,timestamptz),
  public.phase1_create_invitation(bytea,uuid,uuid,timestamptz,uuid),
  public.phase1_complete_invited_profile(uuid,bytea,text,text,text,bytea,bytea,text,bytea,uuid),
  public.phase1_update_membership(uuid,uuid,text,text,text,uuid),
  public.phase1_update_own_profile(uuid,text,text,text,bytea,bytea,text,bytea,uuid),
  public.phase1_begin_idempotency(text,text,uuid,bytea,text,bytea),
  public.phase1_finish_idempotency(text,text,uuid,bytea,text,bytea,uuid,text) to service_role;
