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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chat_poll_votes: {
        Row: {
          created_at: string
          family_id: string
          id: string
          option_index: number
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          option_index: number
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          option_index?: number
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_poll_votes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "chat_polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_polls: {
        Row: {
          created_at: string
          created_by: string
          family_id: string
          id: string
          message_id: string
          options: Json
          question: string
        }
        Insert: {
          created_at?: string
          created_by: string
          family_id: string
          id?: string
          message_id: string
          options: Json
          question: string
        }
        Update: {
          created_at?: string
          created_by?: string
          family_id?: string
          id?: string
          message_id?: string
          options?: Json
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_polls_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_polls_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_polls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_premium: boolean
          join_code: string
          max_members: number
          name: string | null
          premium_until: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_premium?: boolean
          join_code: string
          max_members?: number
          name?: string | null
          premium_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_premium?: boolean
          join_code?: string
          max_members?: number
          name?: string | null
          premium_until?: string | null
        }
        Relationships: []
      }
      family_events: {
        Row: {
          created_at: string
          created_by: string
          event_date: string
          event_type: string
          family_id: string
          id: string
          is_annual: boolean
          title: string
        }
        Insert: {
          created_at?: string
          created_by: string
          event_date: string
          event_type: string
          family_id: string
          id?: string
          is_annual?: boolean
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string
          event_date?: string
          event_type?: string
          family_id?: string
          id?: string
          is_annual?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_events_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          battery_charging: boolean | null
          battery_level: number | null
          family_id: string
          latitude: number
          longitude: number
          updated_at: string
          user_id: string
        }
        Insert: {
          battery_charging?: boolean | null
          battery_level?: number | null
          family_id: string
          latitude: number
          longitude: number
          updated_at?: string
          user_id: string
        }
        Update: {
          battery_charging?: boolean | null
          battery_level?: number | null
          family_id?: string
          latitude?: number
          longitude?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          created_at: string
          family_id: string
          id: string
          media_url: string | null
          message_type: string
          sender_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          family_id: string
          id?: string
          media_url?: string | null
          message_type: string
          sender_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          family_id?: string
          id?: string
          media_url?: string | null
          message_type?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_config: Json
          birth_date: string | null
          color_index: number
          created_at: string
          daily_photo_count: number
          display_name: string | null
          family_id: string | null
          id: string
          is_admin: boolean
          push_token: string | null
          role: string | null
        }
        Insert: {
          avatar_config?: Json
          birth_date?: string | null
          color_index?: number
          created_at?: string
          daily_photo_count?: number
          display_name?: string | null
          family_id?: string | null
          id: string
          is_admin?: boolean
          push_token?: string | null
          role?: string | null
        }
        Update: {
          avatar_config?: Json
          birth_date?: string | null
          color_index?: number
          created_at?: string
          daily_photo_count?: number
          display_name?: string | null
          family_id?: string | null
          id?: string
          is_admin?: boolean
          push_token?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_places: {
        Row: {
          category: string
          created_at: string
          family_id: string
          id: string
          latitude: number
          longitude: number
          title: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          family_id: string
          id?: string
          latitude: number
          longitude: number
          title: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          family_id?: string
          id?: string
          latitude?: number
          longitude?: number
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_places_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_places_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          duration_type: string
          expires_at: string
          family_id: string
          handled_by: string | null
          id: string
          source_message_id: string | null
          status: string
          title: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          duration_type: string
          expires_at: string
          family_id: string
          handled_by?: string | null
          id?: string
          source_message_id?: string | null
          status?: string
          title: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          duration_type?: string
          expires_at?: string
          family_id?: string
          handled_by?: string | null
          id?: string
          source_message_id?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_media_rows: { Args: never; Returns: number }
      cleanup_expired_tasks: { Args: never; Returns: number }
      cleanup_expired_text_messages: { Args: never; Returns: number }
      create_family: {
        Args: {
          p_color_index?: number
          p_display_name?: string
          p_name?: string
          p_role?: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          is_premium: boolean
          join_code: string
          max_members: number
          name: string | null
          premium_until: string | null
        }
        SetofOptions: {
          from: "*"
          to: "families"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_account: { Args: never; Returns: undefined }
      join_family: {
        Args: {
          p_color_index?: number
          p_display_name?: string
          p_join_code: string
          p_role?: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          is_premium: boolean
          join_code: string
          max_members: number
          name: string | null
          premium_until: string | null
        }
        SetofOptions: {
          from: "*"
          to: "families"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      own_push_token: { Args: never; Returns: string }
      regenerate_join_code: { Args: never; Returns: string }
      remove_member: { Args: { p_member_id: string }; Returns: undefined }
      reset_daily_photo_counts: { Args: never; Returns: number }
      set_family_premium: {
        Args: { p_plan: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          is_premium: boolean
          join_code: string
          max_members: number
          name: string | null
          premium_until: string | null
        }
        SetofOptions: {
          from: "*"
          to: "families"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
