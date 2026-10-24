import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type WorkArea = Database["public"]["Enums"]["work_area"];

export interface Me {
  id: string;
  email: string | null;
  name: string | null;
  roles: AppRole[];
  areas: WorkArea[];
  creatorId: string | null;
  isExec: boolean;
  isStaff: boolean;
  isCreator: boolean;
}

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    const { data: u, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!u.user) return null;
    const { data: active, error: activeError } = await supabase.rpc("is_active_member", {
      _user_id: u.user.id,
    });
    if (activeError) throw activeError;
    if (!active) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return null;
    }
    const [roles, areas, profile, creator] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      supabase.from("user_areas").select("area").eq("user_id", u.user.id),
      supabase
        .from("profiles")
        .select("full_name,nickname,avatar_url")
        .eq("id", u.user.id)
        .maybeSingle(),
      supabase.from("creators").select("id").eq("user_id", u.user.id).maybeSingle(),
    ]);
    if (roles.error) throw roles.error;
    if (areas.error) throw areas.error;
    if (profile.error) throw profile.error;
    if (creator.error) throw creator.error;

    const r = roles.data.map((x) => x.role);
    let creatorId = creator.data?.id ?? null;
    if (r.includes("creator")) {
      const { data, error } = await supabase.rpc("resolve_creator_link");
      if (error) throw error;
      creatorId = data ?? creatorId;
      if (!creatorId) throw new Error("Creator account has no valid active workspace. Ask an Executive to review the association.");
    }

    return {
      id: u.user.id,
      email: u.user.email ?? null,
      name: profile.data?.nickname ?? profile.data?.full_name ?? null,
      roles: r,
      areas: areas.data.map((x) => x.area),
      creatorId,
      isExec: r.includes("executive"),
      isStaff: r.includes("executive") || r.includes("employee"),
      isCreator: r.includes("creator"),
    };
  },
});

export const useMe = () => useQuery(meQuery);

/** Employee areas shown in Team & Access, in display order. "sharing" is retired and hidden. */
export const AREA_ORDER = [
  "creator_management",
  "marketing",
  "chatting",
  "operations",
  "admin",
] as const;
export const AREA_LABEL: Record<WorkArea, string> = {
  creator_management: "Creator Management",
  marketing: "Marketing",
  chatting: "Chatting",
  operations: "Operations",
  admin: "Admin",
  creator_manager: "Creator Management (legacy)",
  sharing: "Sharing (retired)",
};

export const TASK_STATUS_LABEL = {
  todo: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "In review",
  done: "Done",
} as const;

export const CREATOR_STATUS_LABEL = {
  lead: "Lead",
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  offboarded: "Offboarded",
} as const;
