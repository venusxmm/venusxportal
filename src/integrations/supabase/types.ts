export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      creator_assignments: {
        Row: {
          area: Database["public"]["Enums"]["work_area"]
          created_at: string
          creator_id: string
          id: string
          user_id: string
        }
        Insert: {
          area: Database["public"]["Enums"]["work_area"]
          created_at?: string
          creator_id: string
          id?: string
          user_id: string
        }
        Update: {
          area?: Database["public"]["Enums"]["work_area"]
          created_at?: string
          creator_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_assignments_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_private_details: {
        Row: {
          creator_id: string
          internal_notes: string | null
          internal_photo_path: string | null
        }
        Insert: {
          creator_id: string
          internal_notes?: string | null
          internal_photo_path?: string | null
        }
        Update: {
          creator_id?: string
          internal_notes?: string | null
          internal_photo_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_private_details_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: true
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      creators: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          legal_name: string | null
          objectives: string | null
          positioning: string | null
          social_links: Json
          stage_name: string
          status: Database["public"]["Enums"]["creator_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          legal_name?: string | null
          objectives?: string | null
          positioning?: string | null
          social_links?: Json
          stage_name: string
          status?: Database["public"]["Enums"]["creator_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          legal_name?: string | null
          objectives?: string | null
          positioning?: string | null
          social_links?: Json
          stage_name?: string
          status?: Database["public"]["Enums"]["creator_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          areas: Database["public"]["Enums"]["work_area"][]
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          areas?: Database["public"]["Enums"]["work_area"][]
          created_at?: string
          created_by?: string
          email: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          areas?: Database["public"]["Enums"]["work_area"][]
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token_hash?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_revoked_at: string | null
          availability: string | null
          avatar_url: string | null
          created_at: string
          description: string | null
          email: string | null
          full_name: string | null
          id: string
          membership_removed_at: string | null
          nickname: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          access_revoked_at?: string | null
          availability?: string | null
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          membership_removed_at?: string | null
          nickname?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          access_revoked_at?: string | null
          availability?: string | null
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          membership_removed_at?: string | null
          nickname?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          creator_id: string | null
          dedupe_key: string | null
          description: string | null
          due_date: string | null
          due_time: string | null
          id: string
          member_type: string | null
          owner_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          source: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          visible_to_creator: boolean
        }
        Insert: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          creator_id?: string | null
          dedupe_key?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          member_type?: string | null
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          source?: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          visible_to_creator?: boolean
        }
        Update: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          creator_id?: string | null
          dedupe_key?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          member_type?: string | null
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          source?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          visible_to_creator?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tasks_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          agency_share_pct: number | null
          amount: number
          archived_at: string | null
          category: string
          created_at: string
          created_by: string | null
          creator_id: string | null
          currency: string
          deduct_from_agency_cut: boolean
          description: string | null
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["txn_kind"]
          occurred_on: string
          shared_with_creator: boolean
          updated_at: string
        }
        Insert: {
          agency_share_pct?: number | null
          amount: number
          archived_at?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          creator_id?: string | null
          currency?: string
          deduct_from_agency_cut?: boolean
          description?: string | null
          external_ref?: string | null
          id?: string
          kind: Database["public"]["Enums"]["txn_kind"]
          occurred_on?: string
          shared_with_creator?: boolean
          updated_at?: string
        }
        Update: {
          agency_share_pct?: number | null
          amount?: number
          archived_at?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          creator_id?: string | null
          currency?: string
          deduct_from_agency_cut?: boolean
          description?: string | null
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["txn_kind"]
          occurred_on?: string
          shared_with_creator?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      user_areas: {
        Row: {
          area: Database["public"]["Enums"]["work_area"]
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          area: Database["public"]["Enums"]["work_area"]
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          area?: Database["public"]["Enums"]["work_area"]
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _link_creator_from_invitation: {
        Args: { _invitation_id: string; _user_id: string }
        Returns: string
      }
      _normalize_email_address: { Args: { _email: string }; Returns: string }
      accept_invitation: { Args: { _token_hash: string }; Returns: boolean }
      can_access_creator: { Args: { _creator_id: string }; Returns: boolean }
      can_see_task: { Args: { _task_id: string }; Returns: boolean }
      claim_first_executive: { Args: never; Returns: boolean }
      create_invitation: {
        Args: {
          _areas?: Database["public"]["Enums"]["work_area"][]
          _email: string
          _role: Database["public"]["Enums"]["app_role"]
          _token_hash: string
        }
        Returns: Json
      }
      creator_set_task_status: {
        Args: {
          _status: Database["public"]["Enums"]["task_status"]
          _task_id: string
        }
        Returns: undefined
      }
      delete_expense: { Args: { _id: string }; Returns: string }
      delete_transaction: { Args: { _id: string }; Returns: string }
      executives_exist: { Args: never; Returns: boolean }
      get_invitation_status: { Args: { _token_hash: string }; Returns: Json }
      has_area: {
        Args: { _area: Database["public"]["Enums"]["work_area"] }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_member: { Args: { _user_id: string }; Returns: boolean }
      is_executive: { Args: never; Returns: boolean }
      is_own_creator: { Args: { _creator_id: string }; Returns: boolean }
      post_creator_payout: {
        Args: {
          _amount: number
          _category: string
          _creator_id: string
          _currency: string
          _description?: string
          _external_ref?: string
          _id: string
          _occurred_on: string
          _shared_with_creator?: boolean
        }
        Returns: string
      }
      remove_team_member: { Args: { _user_id: string }; Returns: boolean }
      resolve_creator_link: { Args: never; Returns: string }
      revoke_invitation: { Args: { _id: string }; Returns: boolean }
      revoke_team_member_access: {
        Args: { _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "executive" | "employee" | "creator" | "partner"
      creator_status: "lead" | "onboarding" | "active" | "paused" | "offboarded"
      task_priority: "low" | "medium" | "high" | "critical"
      task_status: "todo" | "in_progress" | "blocked" | "review" | "done"
      txn_kind: "revenue" | "expense" | "payout"
      work_area:
        | "marketing"
        | "sharing"
        | "operations"
        | "creator_management"
        | "chatting"
        | "creator_manager"
        | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["executive", "employee", "creator", "partner"],
      creator_status: ["lead", "onboarding", "active", "paused", "offboarded"],
      task_priority: ["low", "medium", "high", "critical"],
      task_status: ["todo", "in_progress", "blocked", "review", "done"],
      txn_kind: ["revenue", "expense", "payout"],
      work_area: [
        "marketing",
        "sharing",
        "operations",
        "creator_management",
        "chatting",
        "creator_manager",
        "admin",
      ],
    },
  },
} as const
