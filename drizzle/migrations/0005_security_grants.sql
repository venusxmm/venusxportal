revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_executive() from public, anon;
revoke execute on function public.has_area(public.work_area) from public, anon;
revoke execute on function public.can_access_creator(uuid) from public, anon;
revoke execute on function public.can_see_task(uuid) from public, anon;
revoke execute on function public.is_own_creator(uuid) from public, anon;
revoke execute on function public.creator_set_task_status(uuid, public.task_status) from public, anon;

grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_executive() to authenticated;
grant execute on function public.has_area(public.work_area) to authenticated;
grant execute on function public.can_access_creator(uuid) to authenticated;
grant execute on function public.can_see_task(uuid) to authenticated;
grant execute on function public.is_own_creator(uuid) to authenticated;
grant execute on function public.creator_set_task_status(uuid, public.task_status) to authenticated;
