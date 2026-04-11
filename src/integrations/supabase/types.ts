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
      accounting_connections: {
        Row: {
          access_token: string | null
          account_mappings: Json
          connected_at: string
          id: string
          last_synced: string | null
          myob_company_file_id: string | null
          myob_company_file_name: string | null
          myob_company_file_uri: string | null
          platform: string
          refresh_token: string | null
          token_expires_at: string | null
          user_id: string
          xero_tenant_id: string | null
          xero_tenant_name: string | null
        }
        Insert: {
          access_token?: string | null
          account_mappings?: Json
          connected_at?: string
          id?: string
          last_synced?: string | null
          myob_company_file_id?: string | null
          myob_company_file_name?: string | null
          myob_company_file_uri?: string | null
          platform: string
          refresh_token?: string | null
          token_expires_at?: string | null
          user_id: string
          xero_tenant_id?: string | null
          xero_tenant_name?: string | null
        }
        Update: {
          access_token?: string | null
          account_mappings?: Json
          connected_at?: string
          id?: string
          last_synced?: string | null
          myob_company_file_id?: string | null
          myob_company_file_name?: string | null
          myob_company_file_uri?: string | null
          platform?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          user_id?: string
          xero_tenant_id?: string | null
          xero_tenant_name?: string | null
        }
        Relationships: []
      }
      accounting_push_history: {
        Row: {
          category: string | null
          error_message: string | null
          external_id: string | null
          external_url: string | null
          gst_amount: number | null
          id: string
          invoice_date: string | null
          invoice_id: string
          platform: string
          pushed_at: string
          status: string | null
          supplier_name: string | null
          total_ex_gst: number | null
          total_inc_gst: number | null
          user_id: string
        }
        Insert: {
          category?: string | null
          error_message?: string | null
          external_id?: string | null
          external_url?: string | null
          gst_amount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_id: string
          platform: string
          pushed_at?: string
          status?: string | null
          supplier_name?: string | null
          total_ex_gst?: number | null
          total_inc_gst?: number | null
          user_id: string
        }
        Update: {
          category?: string | null
          error_message?: string | null
          external_id?: string | null
          external_url?: string | null
          gst_amount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_id?: string
          platform?: string
          pushed_at?: string
          status?: string | null
          supplier_name?: string | null
          total_ex_gst?: number | null
          total_inc_gst?: number | null
          user_id?: string
        }
        Relationships: []
      }
      document_lines: {
        Row: {
          accounting_category: string | null
          accounting_code: string | null
          color: string | null
          confidence: number | null
          created_at: string
          document_id: string
          gst: number
          id: string
          parse_strategy: string | null
          product_title: string | null
          quantity: number
          size: string | null
          sku: string | null
          total_cost: number
          unit_cost: number
          user_id: string
        }
        Insert: {
          accounting_category?: string | null
          accounting_code?: string | null
          color?: string | null
          confidence?: number | null
          created_at?: string
          document_id: string
          gst?: number
          id?: string
          parse_strategy?: string | null
          product_title?: string | null
          quantity?: number
          size?: string | null
          sku?: string | null
          total_cost?: number
          unit_cost?: number
          user_id: string
        }
        Update: {
          accounting_category?: string | null
          accounting_code?: string | null
          color?: string | null
          confidence?: number | null
          created_at?: string
          document_id?: string
          gst?: number
          id?: string
          parse_strategy?: string | null
          product_title?: string | null
          quantity?: number
          size?: string | null
          sku?: string | null
          total_cost?: number
          unit_cost?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_lines_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          accounting_category: string | null
          accounting_code: string | null
          created_at: string
          currency: string
          date: string | null
          document_number: string | null
          due_date: string | null
          external_id: string | null
          external_url: string | null
          gst: number
          id: string
          source_type: string
          status: string
          subtotal: number
          supplier_id: string | null
          supplier_name: string | null
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accounting_category?: string | null
          accounting_code?: string | null
          created_at?: string
          currency?: string
          date?: string | null
          document_number?: string | null
          due_date?: string | null
          external_id?: string | null
          external_url?: string | null
          gst?: number
          id?: string
          source_type?: string
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_name?: string | null
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accounting_category?: string | null
          accounting_code?: string | null
          created_at?: string
          currency?: string
          date?: string | null
          document_number?: string | null
          due_date?: string | null
          external_id?: string | null
          external_url?: string | null
          gst?: number
          id?: string
          source_type?: string
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_name?: string | null
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          description: string | null
          document_id: string | null
          gst: number
          id: string
          period_end: string | null
          period_start: string | null
          subcategory: string | null
          supplier_id: string | null
          supplier_name: string | null
          user_id: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          date: string
          description?: string | null
          document_id?: string | null
          gst?: number
          id?: string
          period_end?: string | null
          period_start?: string | null
          subcategory?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          description?: string | null
          document_id?: string | null
          gst?: number
          id?: string
          period_end?: string | null
          period_start?: string | null
          subcategory?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          id: string
          last_updated: string
          location: string
          quantity: number
          user_id: string
          variant_id: string
        }
        Insert: {
          id?: string
          last_updated?: string
          location?: string
          quantity?: number
          user_id: string
          variant_id: string
        }
        Update: {
          id?: string
          last_updated?: string
          location?: string
          quantity?: number
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
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
      markdown_ladder_items: {
        Row: {
          block_reason: string | null
          cost: number | null
          created_at: string
          current_price: number
          current_stage: number
          days_since_last_sale: number
          id: string
          ladder_id: string
          last_sale_at: string | null
          margin_pct: number | null
          next_check_at: string
          original_price: number
          product_title: string
          stage_applied_at: string | null
          status: string
          user_id: string
          variant_id: string | null
          variant_info: string | null
        }
        Insert: {
          block_reason?: string | null
          cost?: number | null
          created_at?: string
          current_price?: number
          current_stage?: number
          days_since_last_sale?: number
          id?: string
          ladder_id: string
          last_sale_at?: string | null
          margin_pct?: number | null
          next_check_at?: string
          original_price?: number
          product_title?: string
          stage_applied_at?: string | null
          status?: string
          user_id: string
          variant_id?: string | null
          variant_info?: string | null
        }
        Update: {
          block_reason?: string | null
          cost?: number | null
          created_at?: string
          current_price?: number
          current_stage?: number
          days_since_last_sale?: number
          id?: string
          ladder_id?: string
          last_sale_at?: string | null
          margin_pct?: number | null
          next_check_at?: string
          original_price?: number
          product_title?: string
          stage_applied_at?: string | null
          status?: string
          user_id?: string
          variant_id?: string | null
          variant_info?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "markdown_ladder_items_ladder_id_fkey"
            columns: ["ladder_id"]
            isOneToOne: false
            referencedRelation: "markdown_ladders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "markdown_ladder_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      markdown_ladders: {
        Row: {
          auto_rollback: boolean
          check_frequency: string
          created_at: string
          id: string
          min_margin_pct: number
          name: string
          rollback_days: number | null
          selection_type: string
          selection_value: string
          stages: Json
          status: string
          sync_to_shopify: boolean
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_rollback?: boolean
          check_frequency?: string
          created_at?: string
          id?: string
          min_margin_pct?: number
          name: string
          rollback_days?: number | null
          selection_type?: string
          selection_value?: string
          stages?: Json
          status?: string
          sync_to_shopify?: boolean
          trigger_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_rollback?: boolean
          check_frequency?: string
          created_at?: string
          id?: string
          min_margin_pct?: number
          name?: string
          rollback_days?: number | null
          selection_type?: string
          selection_value?: string
          stages?: Json
          status?: string
          sync_to_shopify?: boolean
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pos_connections: {
        Row: {
          connected_at: string
          id: string
          last_synced: string | null
          ls_r_access_token: string | null
          ls_r_account_id: string | null
          ls_r_refresh_token: string | null
          ls_r_token_expires_at: string | null
          ls_x_access_token: string | null
          ls_x_domain_prefix: string | null
          ls_x_refresh_token: string | null
          ls_x_token_expires_at: string | null
          platform: string
          shopify_access_token: string | null
          shopify_connected: boolean | null
          shopify_domain: string | null
          user_id: string
        }
        Insert: {
          connected_at?: string
          id?: string
          last_synced?: string | null
          ls_r_access_token?: string | null
          ls_r_account_id?: string | null
          ls_r_refresh_token?: string | null
          ls_r_token_expires_at?: string | null
          ls_x_access_token?: string | null
          ls_x_domain_prefix?: string | null
          ls_x_refresh_token?: string | null
          ls_x_token_expires_at?: string | null
          platform: string
          shopify_access_token?: string | null
          shopify_connected?: boolean | null
          shopify_domain?: string | null
          user_id: string
        }
        Update: {
          connected_at?: string
          id?: string
          last_synced?: string | null
          ls_r_access_token?: string | null
          ls_r_account_id?: string | null
          ls_r_refresh_token?: string | null
          ls_r_token_expires_at?: string | null
          ls_x_access_token?: string | null
          ls_x_domain_prefix?: string | null
          ls_x_refresh_token?: string | null
          ls_x_token_expires_at?: string | null
          platform?: string
          shopify_access_token?: string | null
          shopify_connected?: boolean | null
          shopify_domain?: string | null
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          product_type: string | null
          shopify_product_id: string | null
          title: string
          updated_at: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          product_type?: string | null
          shopify_product_id?: string | null
          title: string
          updated_at?: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          product_type?: string | null
          shopify_product_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          vendor?: string | null
        }
        Relationships: []
      }
      purchase_order_lines: {
        Row: {
          actual_cost: number | null
          color: string | null
          created_at: string
          expected_cost: number
          expected_qty: number
          id: string
          notes: string | null
          product_title: string
          purchase_order_id: string
          received_qty: number
          size: string | null
          sku: string | null
          user_id: string
        }
        Insert: {
          actual_cost?: number | null
          color?: string | null
          created_at?: string
          expected_cost?: number
          expected_qty?: number
          id?: string
          notes?: string | null
          product_title?: string
          purchase_order_id: string
          received_qty?: number
          size?: string | null
          sku?: string | null
          user_id: string
        }
        Update: {
          actual_cost?: number | null
          color?: string | null
          created_at?: string
          expected_cost?: number
          expected_qty?: number
          id?: string
          notes?: string | null
          product_title?: string
          purchase_order_id?: string
          received_qty?: number
          size?: string | null
          sku?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          expected_date: string | null
          id: string
          linked_document_id: string | null
          match_result: Json | null
          notes: string | null
          po_number: string
          status: string
          supplier_id: string | null
          supplier_name: string
          total_cost: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expected_date?: string | null
          id?: string
          linked_document_id?: string | null
          match_result?: Json | null
          notes?: string | null
          po_number: string
          status?: string
          supplier_id?: string | null
          supplier_name: string
          total_cost?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expected_date?: string | null
          id?: string
          linked_document_id?: string | null
          match_result?: Json | null
          notes?: string | null
          po_number?: string
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          total_cost?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_linked_document_id_fkey"
            columns: ["linked_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_data: {
        Row: {
          cost_of_goods: number
          created_at: string
          id: string
          order_ref: string | null
          product_id: string | null
          quantity_sold: number
          revenue: number
          sold_at: string
          source: string
          user_id: string
          variant_id: string | null
        }
        Insert: {
          cost_of_goods?: number
          created_at?: string
          id?: string
          order_ref?: string | null
          product_id?: string | null
          quantity_sold?: number
          revenue?: number
          sold_at?: string
          source?: string
          user_id: string
          variant_id?: string | null
        }
        Update: {
          cost_of_goods?: number
          created_at?: string
          id?: string
          order_ref?: string | null
          product_id?: string | null
          quantity_sold?: number
          revenue?: number
          sold_at?: string
          source?: string
          user_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_data_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_data_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
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
      supplier_profiles: {
        Row: {
          created_at: string
          id: string
          invoices_analysed: number
          is_active: boolean
          profile_data: Json
          supplier_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoices_analysed?: number
          is_active?: boolean
          profile_data?: Json
          supplier_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoices_analysed?: number
          is_active?: boolean
          profile_data?: Json
          supplier_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          avg_margin: number | null
          contact_info: Json
          created_at: string
          currency: string
          id: string
          name: string
          notes: string | null
          total_spend: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_margin?: number | null
          contact_info?: Json
          created_at?: string
          currency?: string
          id?: string
          name: string
          notes?: string | null
          total_spend?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_margin?: number | null
          contact_info?: Json
          created_at?: string
          currency?: string
          id?: string
          name?: string
          notes?: string | null
          total_spend?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      variants: {
        Row: {
          barcode: string | null
          color: string | null
          cost: number
          created_at: string
          id: string
          product_id: string
          quantity: number
          retail_price: number
          shopify_variant_id: string | null
          size: string | null
          sku: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          cost?: number
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          retail_price?: number
          shopify_variant_id?: string | null
          size?: string | null
          sku?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          barcode?: string | null
          color?: string | null
          cost?: number
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          retail_price?: number
          shopify_variant_id?: string | null
          size?: string | null
          sku?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
