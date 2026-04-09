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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      joor_connections: {
        Row: {
          connected_at: string
          id: string
          last_synced: string | null
          oauth_token: string
          token_label: string | null
          user_id: string
        }
        Insert: {
          connected_at?: string
          id?: string
          last_synced?: string | null
          oauth_token: string
          token_label?: string | null
          user_id: string
        }
        Update: {
          connected_at?: string
          id?: string
          last_synced?: string | null
          oauth_token?: string
          token_label?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shopify_connections: {
        Row: {
          access_token: string
          api_version: string
          created_at: string
          default_location_id: string | null
          id: string
          product_status: string
          shop_name: string | null
          store_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          api_version?: string
          created_at?: string
          default_location_id?: string | null
          id?: string
          product_status?: string
          shop_name?: string | null
          store_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          api_version?: string
          created_at?: string
          default_location_id?: string | null
          id?: string
          product_status?: string
          shop_name?: string | null
          store_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shopify_login_tokens: {
        Row: {
          access_token: string
          created_at: string
          id: string
          shop: string
          token: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          shop: string
          token: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          shop?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      shopify_oauth_states: {
        Row: {
          created_at: string
          id: string
          nonce: string
          shop: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nonce: string
          shop: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nonce?: string
          shop?: string
          user_id?: string
        }
        Relationships: []
      }
      shopify_push_history: {
        Row: {
          created_at: string
          errors: number
          id: string
          products_created: number
          products_updated: number
          source: string | null
          store_url: string
          summary: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          errors?: number
          id?: string
          products_created?: number
          products_updated?: number
          source?: string | null
          store_url: string
          summary?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          errors?: number
          id?: string
          products_created?: number
          products_updated?: number
          source?: string | null
          store_url?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shopify_subscriptions: {
        Row: {
          created_at: string
          id: string
          plan_name: string
          shop: string
          shopify_subscription_id: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          plan_name?: string
          shop: string
          shopify_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          plan_name?: string
          shop?: string
          shopify_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wholesale_connections: {
        Row: {
          connected_at: string
          credentials: Json
          id: string
          label: string | null
          last_synced: string | null
          platform: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          credentials?: Json
          id?: string
          label?: string | null
          last_synced?: string | null
          platform: string
          user_id: string
        }
        Update: {
          connected_at?: string
          credentials?: Json
          id?: string
          label?: string | null
          last_synced?: string | null
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
