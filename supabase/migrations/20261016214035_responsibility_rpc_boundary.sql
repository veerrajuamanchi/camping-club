-- The browser calls trip-api, which resolves the current authenticated actor.
-- Legacy responsibility RPCs must not authorize forged p_actor_id values directly.
alter function public.phase3_admin_create_master_responsibility(text, text, text, integer, numeric, uuid) security invoker;
revoke all on function public.phase3_admin_create_master_responsibility(text, text, text, integer, numeric, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_create_master_responsibility(text, text, text, integer, numeric, uuid) to service_role;

alter function public.phase3_admin_update_master_responsibility(uuid, text, text, text, integer, numeric, boolean, uuid) security invoker;
revoke all on function public.phase3_admin_update_master_responsibility(uuid, text, text, text, integer, numeric, boolean, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_update_master_responsibility(uuid, text, text, text, integer, numeric, boolean, uuid) to service_role;

alter function public.phase3_admin_configure_time_slot(uuid, text, boolean, uuid) security invoker;
revoke all on function public.phase3_admin_configure_time_slot(uuid, text, boolean, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_configure_time_slot(uuid, text, boolean, uuid) to service_role;

alter function public.phase3_admin_add_slot_duty(uuid, uuid, integer, numeric, uuid) security invoker;
revoke all on function public.phase3_admin_add_slot_duty(uuid, uuid, integer, numeric, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_add_slot_duty(uuid, uuid, integer, numeric, uuid) to service_role;

alter function public.phase3_admin_update_slot_duty(uuid, integer, numeric, boolean, uuid) security invoker;
revoke all on function public.phase3_admin_update_slot_duty(uuid, integer, numeric, boolean, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_update_slot_duty(uuid, integer, numeric, boolean, uuid) to service_role;

alter function public.phase3_admin_create_custom_time_slot(uuid, date, text, text, text, uuid) security invoker;
revoke all on function public.phase3_admin_create_custom_time_slot(uuid, date, text, text, text, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_create_custom_time_slot(uuid, date, text, text, text, uuid) to service_role;

alter function public.phase3_drop_duty(uuid, uuid, text) security invoker;
revoke all on function public.phase3_drop_duty(uuid, uuid, text) from public,anon,authenticated;
grant execute on function public.phase3_drop_duty(uuid, uuid, text) to service_role;

alter function public.phase3_admin_assign_duty(uuid, uuid, uuid) security invoker;
revoke all on function public.phase3_admin_assign_duty(uuid, uuid, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_assign_duty(uuid, uuid, uuid) to service_role;

alter function public.phase3_admin_reassign_duty(uuid, uuid, uuid, text) security invoker;
revoke all on function public.phase3_admin_reassign_duty(uuid, uuid, uuid, text) from public,anon,authenticated;
grant execute on function public.phase3_admin_reassign_duty(uuid, uuid, uuid, text) to service_role;

alter function public.phase3_admin_set_driver_credit(uuid, uuid, numeric, text, text, uuid) security invoker;
revoke all on function public.phase3_admin_set_driver_credit(uuid, uuid, numeric, text, text, uuid) from public,anon,authenticated;
grant execute on function public.phase3_admin_set_driver_credit(uuid, uuid, numeric, text, text, uuid) to service_role;
