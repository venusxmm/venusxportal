drop policy if exists "tasks read" on public.tasks;
create policy "tasks read" on public.tasks for select to authenticated
  using (
    public.is_active_member(auth.uid())
    and (
      public.is_executive()
      or owner_id = auth.uid()
      or created_by = auth.uid()
      or (
        creator_id is not null
        and public.has_role(auth.uid(), 'employee')
        and public.can_access_creator(creator_id)
      )
      or (
        visible_to_creator
        and creator_id is not null
        and public.is_own_creator(creator_id)
      )
    )
  );
