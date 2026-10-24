REVOKE ALL ON FUNCTION public.create_recovery_invitation(uuid,text,public.app_role,public.work_area[],text) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.create_recovery_invitation(_user_id uuid,_token_hash text,_role public.app_role,_areas public.work_area[] DEFAULT '{}',_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Explicit access recovery is permanently disabled'; END $$;
COMMENT ON FUNCTION public.create_recovery_invitation(uuid,text,public.app_role,public.work_area[],text) IS 'DEPRECATED: explicit access recovery permanently disabled; retained for migration compatibility only.';
COMMENT ON COLUMN public.invitations.recovery_user_id IS 'DEPRECATED: legacy access recovery marker; these invitations cannot be accepted.';
CREATE OR REPLACE FUNCTION public.accept_invitation(_token_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE invite public.invitations; current_email text; confirmed timestamptz; BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_member(auth.uid()) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active account access is required to accept an invitation'; END IF;
 SELECT * INTO invite FROM public.invitations WHERE token_hash=_token_hash FOR UPDATE;
 IF invite.id IS NULL THEN RAISE EXCEPTION 'Invitation is invalid or expired'; END IF;
 IF invite.recovery_user_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='This legacy access invitation is no longer supported'; END IF;
 SELECT email,email_confirmed_at INTO current_email,confirmed FROM auth.users WHERE id=auth.uid();
 IF current_email IS NULL OR public._normalize_email_address(current_email)<>public._normalize_email_address(invite.email) THEN RAISE EXCEPTION 'Sign in with the invited email address'; END IF;
 IF confirmed IS NULL THEN RAISE EXCEPTION 'Confirm your email address before accepting the invitation'; END IF;
 IF invite.accepted_at IS NOT NULL THEN
  IF invite.revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role=invite.role) THEN RAISE EXCEPTION 'This invitation was already used, but its access is no longer active'; END IF;
 ELSE
  IF invite.revoked_at IS NOT NULL OR invite.expires_at<=now() THEN RAISE EXCEPTION 'Invitation is invalid or expired'; END IF;
 END IF;
 IF invite.role='creator' THEN PERFORM public._link_creator_from_invitation(auth.uid(),invite.id); END IF;
 IF invite.accepted_at IS NOT NULL THEN RETURN true; END IF;
 INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),invite.role) ON CONFLICT DO NOTHING;
 INSERT INTO public.user_areas(user_id,area) SELECT auth.uid(),unnest(invite.areas) ON CONFLICT DO NOTHING;
 UPDATE public.invitations SET accepted_at=now() WHERE id=invite.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.accept_invitation(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.restore_team_member_on_role_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id=new.user_id AND (membership_removed_at IS NOT NULL OR access_revoked_at IS NOT NULL)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Role grants cannot restore revoked or removed access'; END IF;
 RETURN new;
END $$;
CREATE OR REPLACE FUNCTION public.prevent_access_restoration() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF (old.membership_removed_at IS NOT NULL AND new.membership_removed_at IS DISTINCT FROM old.membership_removed_at) OR (old.access_revoked_at IS NOT NULL AND new.access_revoked_at IS DISTINCT FROM old.access_revoked_at) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Revoked or removed access cannot be restored'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER prevent_access_restoration BEFORE UPDATE OF membership_removed_at,access_revoked_at ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_access_restoration();