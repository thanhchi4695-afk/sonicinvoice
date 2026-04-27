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
      agent_budgets: {
        Row: {
          degraded: boolean
          last_reset_at: string
          month_start: string
          monthly_cap_cents: number
          spent_cents: number
          user_id: string
        }
        Insert: {
          degraded?: boolean
          last_reset_at?: string
          month_start?: string
          monthly_cap_cents?: number
          spent_cents?: number
          user_id: string
        }
        Update: {
          degraded?: boolean
          last_reset_at?: string
          month_start?: string
          monthly_cap_cents?: number
          spent_cents?: number
          user_id?: string
        }
        Relationships: []
      }
      agent_calibration_log: {
        Row: {
          created_at: string
          id: string
          predicted_confidence: number | null
          session_id: string | null
          step: string | null
          user_accepted: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          predicted_confidence?: number | null
          session_id?: string | null
          step?: string | null
          user_accepted?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          predicted_confidence?: number | null
          session_id?: string | null
          step?: string | null
          user_accepted?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_calibration_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_decisions: {
        Row: {
          completion_tokens: number | null
          confidence: number | null
          cost_cents: number
          created_at: string
          decision_type: string
          id: string
          model: string | null
          prompt_tokens: number | null
          reasoning: string | null
          session_id: string | null
          step_run_id: string | null
          user_id: string
        }
        Insert: {
          completion_tokens?: number | null
          confidence?: number | null
          cost_cents?: number
          created_at?: string
          decision_type: string
          id?: string
          model?: string | null
          prompt_tokens?: number | null
          reasoning?: string | null
          session_id?: string | null
          step_run_id?: string | null
          user_id: string
        }
        Update: {
          completion_tokens?: number | null
          confidence?: number | null
          cost_cents?: number
          created_at?: string
          decision_type?: string
          id?: string
          model?: string | null
          prompt_tokens?: number | null
          reasoning?: string | null
          session_id?: string | null
          step_run_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_decisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_decisions_step_run_id_fkey"
            columns: ["step_run_id"]
            isOneToOne: false
            referencedRelation: "agent_step_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_feedback: {
        Row: {
          corrected_value: Json | null
          created_at: string
          delta_reason: string | null
          feedback_type: string
          id: string
          original_value: Json | null
          session_id: string | null
          step_run_id: string | null
          supplier: string | null
          user_id: string
        }
        Insert: {
          corrected_value?: Json | null
          created_at?: string
          delta_reason?: string | null
          feedback_type: string
          id?: string
          original_value?: Json | null
          session_id?: string | null
          step_run_id?: string | null
          supplier?: string | null
          user_id: string
        }
        Update: {
          corrected_value?: Json | null
          created_at?: string
          delta_reason?: string | null
          feedback_type?: string
          id?: string
          original_value?: Json | null
          session_id?: string | null
          step_run_id?: string | null
          supplier?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_feedback_step_run_id_fkey"
            columns: ["step_run_id"]
            isOneToOne: false
            referencedRelation: "agent_step_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_global_budget: {
        Row: {
          id: number
          month_start: string
          monthly_cap_cents: number
          spent_cents: number
        }
        Insert: {
          id?: number
          month_start?: string
          monthly_cap_cents?: number
          spent_cents?: number
        }
        Update: {
          id?: number
          month_start?: string
          monthly_cap_cents?: number
          spent_cents?: number
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          auto_published: boolean
          completed_at: string | null
          current_step: string | null
          enrichment_complete: boolean
          enrichment_completed_at: string | null
          error_message: string | null
          human_review_required: boolean
          id: string
          invoice_filename: string | null
          invoice_id: string | null
          metadata: Json
          pipeline_steps: Json
          products_auto_approved: number
          products_extracted: number
          products_flagged: number
          retry_count: number
          started_at: string
          status: string
          supplier_name: string | null
          supplier_profile_id: string | null
          trigger_type: string
          user_id: string
        }
        Insert: {
          auto_published?: boolean
          completed_at?: string | null
          current_step?: string | null
          enrichment_complete?: boolean
          enrichment_completed_at?: string | null
          error_message?: string | null
          human_review_required?: boolean
          id?: string
          invoice_filename?: string | null
          invoice_id?: string | null
          metadata?: Json
          pipeline_steps?: Json
          products_auto_approved?: number
          products_extracted?: number
          products_flagged?: number
          retry_count?: number
          started_at?: string
          status?: string
          supplier_name?: string | null
          supplier_profile_id?: string | null
          trigger_type?: string
          user_id: string
        }
        Update: {
          auto_published?: boolean
          completed_at?: string | null
          current_step?: string | null
          enrichment_complete?: boolean
          enrichment_completed_at?: string | null
          error_message?: string | null
          human_review_required?: boolean
          id?: string
          invoice_filename?: string | null
          invoice_id?: string | null
          metadata?: Json
          pipeline_steps?: Json
          products_auto_approved?: number
          products_extracted?: number
          products_flagged?: number
          retry_count?: number
          started_at?: string
          status?: string
          supplier_name?: string | null
          supplier_profile_id?: string | null
          trigger_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_supplier_profile_id_fkey"
            columns: ["supplier_profile_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          agent_mode: string
          completed_at: string | null
          current_step: string | null
          delivery_id: string | null
          error: Json | null
          gate_count: number
          id: string
          invoice_id: string | null
          last_narrative: string | null
          metadata: Json
          started_at: string
          status: string
          total_cost_cents: number
          user_id: string
        }
        Insert: {
          agent_mode?: string
          completed_at?: string | null
          current_step?: string | null
          delivery_id?: string | null
          error?: Json | null
          gate_count?: number
          id?: string
          invoice_id?: string | null
          last_narrative?: string | null
          metadata?: Json
          started_at?: string
          status?: string
          total_cost_cents?: number
          user_id: string
        }
        Update: {
          agent_mode?: string
          completed_at?: string | null
          current_step?: string | null
          delivery_id?: string | null
          error?: Json | null
          gate_count?: number
          id?: string
          invoice_id?: string | null
          last_narrative?: string | null
          metadata?: Json
          started_at?: string
          status?: string
          total_cost_cents?: number
          user_id?: string
        }
        Relationships: []
      }
      agent_step_runs: {
        Row: {
          attempt: number
          confidence: number | null
          cost_cents: number
          duration_ms: number | null
          edge_function: string | null
          ended_at: string | null
          id: string
          input: Json | null
          narrative: string | null
          output: Json | null
          session_id: string
          started_at: string
          status: string
          step: string
          user_id: string
        }
        Insert: {
          attempt?: number
          confidence?: number | null
          cost_cents?: number
          duration_ms?: number | null
          edge_function?: string | null
          ended_at?: string | null
          id?: string
          input?: Json | null
          narrative?: string | null
          output?: Json | null
          session_id: string
          started_at?: string
          status: string
          step: string
          user_id: string
        }
        Update: {
          attempt?: number
          confidence?: number | null
          cost_cents?: number
          duration_ms?: number | null
          edge_function?: string | null
          ended_at?: string | null
          id?: string
          input?: Json | null
          narrative?: string | null
          output?: Json | null
          session_id?: string
          started_at?: string
          status?: string
          step?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_step_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          brand_sync_last_run_at: string | null
          brand_sync_last_status: string | null
          brand_sync_schedule: string
          brand_sync_sheet_url: string | null
          created_at: string
          id: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          brand_sync_last_run_at?: string | null
          brand_sync_last_status?: string | null
          brand_sync_schedule?: string
          brand_sync_sheet_url?: string | null
          created_at?: string
          id?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          brand_sync_last_run_at?: string | null
          brand_sync_last_status?: string | null
          brand_sync_schedule?: string
          brand_sync_sheet_url?: string | null
          created_at?: string
          id?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      brand_database: {
        Row: {
          brand_name: string
          canonical_brand_name: string | null
          country_origin: string | null
          created_at: string
          enrichment_enabled: boolean
          id: string
          is_shopify: boolean
          notes: string | null
          product_categories: string | null
          products_json_endpoint: string | null
          updated_at: string
          user_id: string
          verified_date: string | null
          website_url: string | null
        }
        Insert: {
          brand_name: string
          canonical_brand_name?: string | null
          country_origin?: string | null
          created_at?: string
          enrichment_enabled?: boolean
          id?: string
          is_shopify?: boolean
          notes?: string | null
          product_categories?: string | null
          products_json_endpoint?: string | null
          updated_at?: string
          user_id: string
          verified_date?: string | null
          website_url?: string | null
        }
        Update: {
          brand_name?: string
          canonical_brand_name?: string | null
          country_origin?: string | null
          created_at?: string
          enrichment_enabled?: boolean
          id?: string
          is_shopify?: boolean
          notes?: string | null
          product_categories?: string | null
          products_json_endpoint?: string | null
          updated_at?: string
          user_id?: string
          verified_date?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      brand_lookup_misses: {
        Row: {
          id: string
          normalised: string
          occurred_at: string
          occurrence_count: number
          raw_brand: string
          user_id: string
        }
        Insert: {
          id?: string
          normalised: string
          occurred_at?: string
          occurrence_count?: number
          raw_brand: string
          user_id: string
        }
        Update: {
          id?: string
          normalised?: string
          occurred_at?: string
          occurrence_count?: number
          raw_brand?: string
          user_id?: string
        }
        Relationships: []
      }
      brand_patterns: {
        Row: {
          brand_name: string | null
          colour_column_name: string | null
          created_at: string
          id: string
          product_type_keywords: Json
          size_scale_examples: Json
          sku_format_regex: string | null
          sku_prefix_pattern: string | null
          special_rules: Json
          supplier_profile_id: string | null
          user_id: string
        }
        Insert: {
          brand_name?: string | null
          colour_column_name?: string | null
          created_at?: string
          id?: string
          product_type_keywords?: Json
          size_scale_examples?: Json
          sku_format_regex?: string | null
          sku_prefix_pattern?: string | null
          special_rules?: Json
          supplier_profile_id?: string | null
          user_id: string
        }
        Update: {
          brand_name?: string | null
          colour_column_name?: string | null
          created_at?: string
          id?: string
          product_type_keywords?: Json
          size_scale_examples?: Json
          sku_format_regex?: string | null
          sku_prefix_pattern?: string | null
          special_rules?: Json
          supplier_profile_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_patterns_supplier_profile_id_fkey"
            columns: ["supplier_profile_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_rules: {
        Row: {
          brand: string
          created_at: string
          id: string
          notes: string | null
          rule_data: Json
          rule_type: string
          updated_at: string
        }
        Insert: {
          brand: string
          created_at?: string
          id?: string
          notes?: string | null
          rule_data?: Json
          rule_type: string
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          id?: string
          notes?: string | null
          rule_data?: Json
          rule_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      brand_sync_log: {
        Row: {
          error_details: Json
          id: string
          rows_errored: number
          rows_inserted: number
          rows_skipped: number
          rows_updated: number
          source_url: string | null
          synced_at: string
          triggered_by: string
          user_id: string
        }
        Insert: {
          error_details?: Json
          id?: string
          rows_errored?: number
          rows_inserted?: number
          rows_skipped?: number
          rows_updated?: number
          source_url?: string | null
          synced_at?: string
          triggered_by?: string
          user_id: string
        }
        Update: {
          error_details?: Json
          id?: string
          rows_errored?: number
          rows_inserted?: number
          rows_skipped?: number
          rows_updated?: number
          source_url?: string | null
          synced_at?: string
          triggered_by?: string
          user_id?: string
        }
        Relationships: []
      }
      competitor_monitored_products: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          product_sku: string | null
          product_title: string
          product_type: string | null
          product_vendor: string | null
          retail_price: number
          shopify_product_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_sku?: string | null
          product_title: string
          product_type?: string | null
          product_vendor?: string | null
          retail_price?: number
          shopify_product_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_sku?: string | null
          product_title?: string
          product_type?: string | null
          product_vendor?: string | null
          retail_price?: number
          shopify_product_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_monitored_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_price_changes: {
        Row: {
          change_detail: string | null
          change_method: string
          competitor_id: string
          competitor_price: number
          created_at: string
          id: string
          monitored_product_id: string
          new_price: number
          old_price: number
          shopify_updated: boolean
          user_id: string
        }
        Insert: {
          change_detail?: string | null
          change_method?: string
          competitor_id: string
          competitor_price: number
          created_at?: string
          id?: string
          monitored_product_id: string
          new_price: number
          old_price: number
          shopify_updated?: boolean
          user_id: string
        }
        Update: {
          change_detail?: string | null
          change_method?: string
          competitor_id?: string
          competitor_price?: number
          created_at?: string
          id?: string
          monitored_product_id?: string
          new_price?: number
          old_price?: number
          shopify_updated?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_price_changes_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_price_changes_monitored_product_id_fkey"
            columns: ["monitored_product_id"]
            isOneToOne: false
            referencedRelation: "competitor_monitored_products"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_prices: {
        Row: {
          competitor_id: string
          competitor_price: number | null
          confidence_score: number | null
          created_at: string
          error_message: string | null
          id: string
          last_checked: string
          match_status: string
          matched_title: string | null
          matched_url: string | null
          monitored_product_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          competitor_id: string
          competitor_price?: number | null
          confidence_score?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_checked?: string
          match_status?: string
          matched_title?: string | null
          matched_url?: string | null
          monitored_product_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          competitor_id?: string
          competitor_price?: number | null
          confidence_score?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_checked?: string
          match_status?: string
          matched_title?: string | null
          matched_url?: string | null
          monitored_product_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_prices_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_prices_monitored_product_id_fkey"
            columns: ["monitored_product_id"]
            isOneToOne: false
            referencedRelation: "competitor_monitored_products"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_shopify: boolean
          name: string
          updated_at: string
          user_id: string
          website_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_shopify?: boolean
          name: string
          updated_at?: string
          user_id: string
          website_url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_shopify?: boolean
          name?: string
          updated_at?: string
          user_id?: string
          website_url?: string
        }
        Relationships: []
      }
      correction_log: {
        Row: {
          auto_detected: boolean
          corrected_value: string | null
          correction_reason: string | null
          correction_reason_detail: string | null
          created_at: string
          field_category: string | null
          field_corrected: string | null
          id: string
          invoice_id: string | null
          invoice_pattern_id: string | null
          original_value: string | null
          session_invoice_index: number | null
          supplier_name: string | null
          supplier_profile_id: string | null
          user_id: string
        }
        Insert: {
          auto_detected?: boolean
          corrected_value?: string | null
          correction_reason?: string | null
          correction_reason_detail?: string | null
          created_at?: string
          field_category?: string | null
          field_corrected?: string | null
          id?: string
          invoice_id?: string | null
          invoice_pattern_id?: string | null
          original_value?: string | null
          session_invoice_index?: number | null
          supplier_name?: string | null
          supplier_profile_id?: string | null
          user_id: string
        }
        Update: {
          auto_detected?: boolean
          corrected_value?: string | null
          correction_reason?: string | null
          correction_reason_detail?: string | null
          created_at?: string
          field_category?: string | null
          field_corrected?: string | null
          id?: string
          invoice_id?: string | null
          invoice_pattern_id?: string | null
          original_value?: string | null
          session_invoice_index?: number | null
          supplier_name?: string | null
          supplier_profile_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_log_invoice_pattern_id_fkey"
            columns: ["invoice_pattern_id"]
            isOneToOne: false
            referencedRelation: "invoice_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_log_supplier_profile_id_fkey"
            columns: ["supplier_profile_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          source_filename: string | null
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
          source_filename?: string | null
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
          source_filename?: string | null
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
      gmail_connections: {
        Row: {
          access_token: string
          created_at: string
          email_address: string
          expires_at: string
          id: string
          is_active: boolean
          last_checked_at: string | null
          last_email_id: string | null
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          email_address: string
          expires_at: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          last_email_id?: string | null
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          email_address?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          last_email_id?: string | null
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gmail_found_invoices: {
        Row: {
          agent_run_id: string | null
          attachments: Json
          created_at: string
          from_email: string | null
          id: string
          known_supplier: boolean
          message_id: string
          processed: boolean
          received_at: string | null
          subject: string | null
          supplier_name: string | null
          user_id: string
        }
        Insert: {
          agent_run_id?: string | null
          attachments?: Json
          created_at?: string
          from_email?: string | null
          id?: string
          known_supplier?: boolean
          message_id: string
          processed?: boolean
          received_at?: string | null
          subject?: string | null
          supplier_name?: string | null
          user_id: string
        }
        Update: {
          agent_run_id?: string | null
          attachments?: Json
          created_at?: string
          from_email?: string | null
          id?: string
          known_supplier?: boolean
          message_id?: string
          processed?: boolean
          received_at?: string | null
          subject?: string | null
          supplier_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_found_invoices_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
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
      inventory_adjustments: {
        Row: {
          adjusted_at: string
          adjustment_qty: number
          barcode: string | null
          created_at: string
          id: string
          location: string
          product_title: string | null
          reason: string | null
          shopify_variant_id: string | null
          sku: string | null
          user_id: string
        }
        Insert: {
          adjusted_at?: string
          adjustment_qty?: number
          barcode?: string | null
          created_at?: string
          id?: string
          location?: string
          product_title?: string | null
          reason?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          user_id: string
        }
        Update: {
          adjusted_at?: string
          adjustment_qty?: number
          barcode?: string | null
          created_at?: string
          id?: string
          location?: string
          product_title?: string | null
          reason?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          user_id?: string
        }
        Relationships: []
      }
      inventory_import_runs: {
        Row: {
          after_snapshot: Json
          before_snapshot: Json
          changes: Json
          colour: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          group_key: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          location_id: string | null
          location_name: string | null
          product_title: string | null
          run_status: string
          shopify_product_id: string | null
          source: string
          started_at: string
          style_number: string | null
          supplier_name: string | null
          units_applied: number
          user_id: string
        }
        Insert: {
          after_snapshot?: Json
          before_snapshot?: Json
          changes?: Json
          colour?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          group_key?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          location_id?: string | null
          location_name?: string | null
          product_title?: string | null
          run_status?: string
          shopify_product_id?: string | null
          source?: string
          started_at?: string
          style_number?: string | null
          supplier_name?: string | null
          units_applied?: number
          user_id: string
        }
        Update: {
          after_snapshot?: Json
          before_snapshot?: Json
          changes?: Json
          colour?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          group_key?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          location_id?: string | null
          location_name?: string | null
          product_title?: string | null
          run_status?: string
          shopify_product_id?: string | null
          source?: string
          started_at?: string
          style_number?: string | null
          supplier_name?: string | null
          units_applied?: number
          user_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Relationships: []
      }
      invoice_line_edits: {
        Row: {
          edited_at: string
          field: string
          id: string
          invoice_pattern_id: string | null
          new_value: string | null
          old_value: string | null
          row_index: number | null
          user_id: string
        }
        Insert: {
          edited_at?: string
          field: string
          id?: string
          invoice_pattern_id?: string | null
          new_value?: string | null
          old_value?: string | null
          row_index?: number | null
          user_id: string
        }
        Update: {
          edited_at?: string
          field?: string
          id?: string
          invoice_pattern_id?: string | null
          new_value?: string | null
          old_value?: string | null
          row_index?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_edits_invoice_pattern_id_fkey"
            columns: ["invoice_pattern_id"]
            isOneToOne: false
            referencedRelation: "invoice_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_patterns: {
        Row: {
          column_map: Json
          created_at: string
          default_markup_multiplier: number | null
          edit_count: number | null
          exported_at: string | null
          field_confidence_history: Json
          fields_corrected: string[] | null
          format_type: string | null
          gst_included_in_cost: boolean | null
          gst_included_in_rrp: boolean | null
          id: string
          invoice_count: number
          layout_fingerprint: string | null
          match_method: string | null
          original_file_mime: string | null
          original_file_path: string | null
          original_filename: string | null
          pack_notation_detected: boolean | null
          price_column_cost: string | null
          price_column_rrp: string | null
          processing_completed_at: string | null
          processing_duration_seconds: number | null
          processing_quality_score: number | null
          processing_started_at: string | null
          review_duration_seconds: number | null
          review_status: string | null
          rows_added: number | null
          rows_deleted: number | null
          rows_seen: number | null
          sample_headers: Json
          size_matrix_detected: boolean | null
          size_system: string | null
          supplier_profile_id: string | null
          updated_at: string
          user_id: string
          variants_extracted: number | null
        }
        Insert: {
          column_map?: Json
          created_at?: string
          default_markup_multiplier?: number | null
          edit_count?: number | null
          exported_at?: string | null
          field_confidence_history?: Json
          fields_corrected?: string[] | null
          format_type?: string | null
          gst_included_in_cost?: boolean | null
          gst_included_in_rrp?: boolean | null
          id?: string
          invoice_count?: number
          layout_fingerprint?: string | null
          match_method?: string | null
          original_file_mime?: string | null
          original_file_path?: string | null
          original_filename?: string | null
          pack_notation_detected?: boolean | null
          price_column_cost?: string | null
          price_column_rrp?: string | null
          processing_completed_at?: string | null
          processing_duration_seconds?: number | null
          processing_quality_score?: number | null
          processing_started_at?: string | null
          review_duration_seconds?: number | null
          review_status?: string | null
          rows_added?: number | null
          rows_deleted?: number | null
          rows_seen?: number | null
          sample_headers?: Json
          size_matrix_detected?: boolean | null
          size_system?: string | null
          supplier_profile_id?: string | null
          updated_at?: string
          user_id: string
          variants_extracted?: number | null
        }
        Update: {
          column_map?: Json
          created_at?: string
          default_markup_multiplier?: number | null
          edit_count?: number | null
          exported_at?: string | null
          field_confidence_history?: Json
          fields_corrected?: string[] | null
          format_type?: string | null
          gst_included_in_cost?: boolean | null
          gst_included_in_rrp?: boolean | null
          id?: string
          invoice_count?: number
          layout_fingerprint?: string | null
          match_method?: string | null
          original_file_mime?: string | null
          original_file_path?: string | null
          original_filename?: string | null
          pack_notation_detected?: boolean | null
          price_column_cost?: string | null
          price_column_rrp?: string | null
          processing_completed_at?: string | null
          processing_duration_seconds?: number | null
          processing_quality_score?: number | null
          processing_started_at?: string | null
          review_duration_seconds?: number | null
          review_status?: string | null
          rows_added?: number | null
          rows_deleted?: number | null
          rows_seen?: number | null
          sample_headers?: Json
          size_matrix_detected?: boolean | null
          size_system?: string | null
          supplier_profile_id?: string | null
          updated_at?: string
          user_id?: string
          variants_extracted?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_patterns_supplier_profile_id_fkey"
            columns: ["supplier_profile_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
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
      platform_connections: {
        Row: {
          access_token: string | null
          created_at: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          location_id: string | null
          needs_reauth: boolean
          platform: string
          refresh_token: string | null
          refresh_token_expires_at: string | null
          shop_domain: string | null
          token_expires_at: string | null
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          location_id?: string | null
          needs_reauth?: boolean
          platform: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          shop_domain?: string | null
          token_expires_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          location_id?: string | null
          needs_reauth?: boolean
          platform?: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          shop_domain?: string | null
          token_expires_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      po_receipts: {
        Row: {
          created_at: string
          id: string
          line_items: Json
          po_id: string
          pushed_at: string | null
          received_by: string | null
          received_date: string
          shopify_push_error: string | null
          shopify_push_status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_items?: Json
          po_id: string
          pushed_at?: string | null
          received_by?: string | null
          received_date?: string
          shopify_push_error?: string | null
          shopify_push_status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          line_items?: Json
          po_id?: string
          pushed_at?: string | null
          received_by?: string | null
          received_date?: string
          shopify_push_error?: string | null
          shopify_push_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      po_settings: {
        Row: {
          created_at: string
          default_lead_time_days: number
          email_body_template: string | null
          email_subject_template: string | null
          logo_url: string | null
          payment_terms: string | null
          store_abn: string | null
          store_address: string | null
          store_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_lead_time_days?: number
          email_body_template?: string | null
          email_subject_template?: string | null
          logo_url?: string | null
          payment_terms?: string | null
          store_abn?: string | null
          store_address?: string | null
          store_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_lead_time_days?: number
          email_body_template?: string | null
          email_subject_template?: string | null
          logo_url?: string | null
          payment_terms?: string | null
          store_abn?: string | null
          store_address?: string | null
          store_name?: string | null
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
      price_lookups: {
        Row: {
          colour: string | null
          created_at: string
          description: string | null
          id: string
          image_urls: Json | null
          notes: string | null
          price_confidence: number | null
          product_name: string
          retail_price_aud: number | null
          source_url: string | null
          style_number: string | null
          supplier: string
          supplier_cost: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          colour?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: Json | null
          notes?: string | null
          price_confidence?: number | null
          product_name: string
          retail_price_aud?: number | null
          source_url?: string | null
          style_number?: string | null
          supplier: string
          supplier_cost?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          colour?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: Json | null
          notes?: string | null
          price_confidence?: number | null
          product_name?: string
          retail_price_aud?: number | null
          source_url?: string | null
          style_number?: string | null
          supplier?: string
          supplier_cost?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      processing_queue: {
        Row: {
          attempts: number
          batch_id: string | null
          created_at: string
          drive_file_id: string | null
          error: string | null
          file_name: string
          file_size_bytes: number | null
          file_type: string | null
          finished_at: string | null
          id: string
          pattern_id: string | null
          position: number
          source: string
          source_url: string | null
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          upload_id: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          batch_id?: string | null
          created_at?: string
          drive_file_id?: string | null
          error?: string | null
          file_name: string
          file_size_bytes?: number | null
          file_type?: string | null
          finished_at?: string | null
          id?: string
          pattern_id?: string | null
          position?: number
          source?: string
          source_url?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          upload_id?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          batch_id?: string | null
          created_at?: string
          drive_file_id?: string | null
          error?: string | null
          file_name?: string
          file_size_bytes?: number | null
          file_type?: string | null
          finished_at?: string | null
          id?: string
          pattern_id?: string | null
          position?: number
          source?: string
          source_url?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          upload_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      product_catalog_cache: {
        Row: {
          barcode: string | null
          cached_at: string
          colour: string | null
          current_cost: number | null
          current_price: number | null
          current_qty: number | null
          id: string
          platform: string
          platform_product_id: string
          platform_variant_id: string | null
          product_title: string | null
          size: string | null
          sku: string | null
          user_id: string
          variant_title: string | null
          vendor: string | null
        }
        Insert: {
          barcode?: string | null
          cached_at?: string
          colour?: string | null
          current_cost?: number | null
          current_price?: number | null
          current_qty?: number | null
          id?: string
          platform: string
          platform_product_id: string
          platform_variant_id?: string | null
          product_title?: string | null
          size?: string | null
          sku?: string | null
          user_id: string
          variant_title?: string | null
          vendor?: string | null
        }
        Update: {
          barcode?: string | null
          cached_at?: string
          colour?: string | null
          current_cost?: number | null
          current_price?: number | null
          current_qty?: number | null
          id?: string
          platform?: string
          platform_product_id?: string
          platform_variant_id?: string | null
          product_title?: string | null
          size?: string | null
          sku?: string | null
          user_id?: string
          variant_title?: string | null
          vendor?: string | null
        }
        Relationships: []
      }
      product_reorder_settings: {
        Row: {
          created_at: string
          desired_cover_days: number
          id: string
          lead_time_days: number
          min_order_qty: number
          safety_stock_days: number
          supplier_id: string | null
          updated_at: string
          user_id: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          desired_cover_days?: number
          id?: string
          lead_time_days?: number
          min_order_qty?: number
          safety_stock_days?: number
          supplier_id?: string | null
          updated_at?: string
          user_id: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          desired_cover_days?: number
          id?: string
          lead_time_days?: number
          min_order_qty?: number
          safety_stock_days?: number
          supplier_id?: string | null
          updated_at?: string
          user_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_reorder_settings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reorder_settings_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          enriched_at: string | null
          enrichment_source: string | null
          id: string
          image_url: string | null
          product_type: string | null
          shopify_product_id: string | null
          source: string | null
          title: string
          updated_at: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          enriched_at?: string | null
          enrichment_source?: string | null
          id?: string
          image_url?: string | null
          product_type?: string | null
          shopify_product_id?: string | null
          source?: string | null
          title: string
          updated_at?: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          enriched_at?: string | null
          enrichment_source?: string | null
          id?: string
          image_url?: string | null
          product_type?: string | null
          shopify_product_id?: string | null
          source?: string | null
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
          barcode: string | null
          color: string | null
          created_at: string
          expected_cost: number
          expected_qty: number
          id: string
          notes: string | null
          product_title: string
          purchase_order_id: string
          received_qty: number
          shopify_product_id: string | null
          shopify_variant_id: string | null
          size: string | null
          sku: string | null
          user_id: string
          variant_title: string | null
        }
        Insert: {
          actual_cost?: number | null
          barcode?: string | null
          color?: string | null
          created_at?: string
          expected_cost?: number
          expected_qty?: number
          id?: string
          notes?: string | null
          product_title?: string
          purchase_order_id: string
          received_qty?: number
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          size?: string | null
          sku?: string | null
          user_id: string
          variant_title?: string | null
        }
        Update: {
          actual_cost?: number | null
          barcode?: string | null
          color?: string | null
          created_at?: string
          expected_cost?: number
          expected_qty?: number
          id?: string
          notes?: string | null
          product_title?: string
          purchase_order_id?: string
          received_qty?: number
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          size?: string | null
          sku?: string | null
          user_id?: string
          variant_title?: string | null
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
          archived_at: string | null
          created_at: string
          expected_date: string | null
          grand_total: number
          id: string
          invoice_number: string | null
          linked_document_id: string | null
          match_result: Json | null
          notes: string | null
          notes_internal: string | null
          notes_supplier: string | null
          po_date: string | null
          po_number: string
          sent_at: string | null
          ship_to_location: string | null
          shipping: number
          status: string
          subtotal: number
          supplier_email: string | null
          supplier_id: string | null
          supplier_name: string
          tax: number
          total_cost: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          expected_date?: string | null
          grand_total?: number
          id?: string
          invoice_number?: string | null
          linked_document_id?: string | null
          match_result?: Json | null
          notes?: string | null
          notes_internal?: string | null
          notes_supplier?: string | null
          po_date?: string | null
          po_number: string
          sent_at?: string | null
          ship_to_location?: string | null
          shipping?: number
          status?: string
          subtotal?: number
          supplier_email?: string | null
          supplier_id?: string | null
          supplier_name: string
          tax?: number
          total_cost?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          expected_date?: string | null
          grand_total?: number
          id?: string
          invoice_number?: string | null
          linked_document_id?: string | null
          match_result?: Json | null
          notes?: string | null
          notes_internal?: string | null
          notes_supplier?: string | null
          po_date?: string | null
          po_number?: string
          sent_at?: string | null
          ship_to_location?: string | null
          shipping?: number
          status?: string
          subtotal?: number
          supplier_email?: string | null
          supplier_id?: string | null
          supplier_name?: string
          tax?: number
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
      reconciliation_lines: {
        Row: {
          conflict_reason: string | null
          cost_delta_pct: number | null
          created_at: string
          id: string
          invoice_colour: string | null
          invoice_cost: number | null
          invoice_product_name: string | null
          invoice_qty: number | null
          invoice_rrp: number | null
          invoice_size: string | null
          invoice_sku: string | null
          match_type: string | null
          matched_current_cost: number | null
          matched_current_qty: number | null
          matched_product_id: string | null
          matched_variant_id: string | null
          session_id: string
          user_decision: string | null
          user_id: string
        }
        Insert: {
          conflict_reason?: string | null
          cost_delta_pct?: number | null
          created_at?: string
          id?: string
          invoice_colour?: string | null
          invoice_cost?: number | null
          invoice_product_name?: string | null
          invoice_qty?: number | null
          invoice_rrp?: number | null
          invoice_size?: string | null
          invoice_sku?: string | null
          match_type?: string | null
          matched_current_cost?: number | null
          matched_current_qty?: number | null
          matched_product_id?: string | null
          matched_variant_id?: string | null
          session_id: string
          user_decision?: string | null
          user_id: string
        }
        Update: {
          conflict_reason?: string | null
          cost_delta_pct?: number | null
          created_at?: string
          id?: string
          invoice_colour?: string | null
          invoice_cost?: number | null
          invoice_product_name?: string | null
          invoice_qty?: number | null
          invoice_rrp?: number | null
          invoice_size?: string | null
          invoice_sku?: string | null
          match_type?: string | null
          matched_current_cost?: number | null
          matched_current_qty?: number | null
          matched_product_id?: string | null
          matched_variant_id?: string | null
          session_id?: string
          user_decision?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_sessions: {
        Row: {
          conflicts: number
          created_at: string
          exact_refills: number
          id: string
          invoice_id: string | null
          new_products: number
          new_variants: number
          platform: string | null
          status: string
          supplier_name: string | null
          total_lines: number | null
          user_id: string
        }
        Insert: {
          conflicts?: number
          created_at?: string
          exact_refills?: number
          id?: string
          invoice_id?: string | null
          new_products?: number
          new_variants?: number
          platform?: string | null
          status?: string
          supplier_name?: string | null
          total_lines?: number | null
          user_id: string
        }
        Update: {
          conflicts?: number
          created_at?: string
          exact_refills?: number
          id?: string
          invoice_id?: string | null
          new_products?: number
          new_variants?: number
          platform?: string | null
          status?: string
          supplier_name?: string | null
          total_lines?: number | null
          user_id?: string
        }
        Relationships: []
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
      search_results_cache: {
        Row: {
          cache_key: string
          cost_aud: number
          created_at: string
          description: string | null
          expires_at: string
          found: boolean
          hit_count: number
          image_url: string | null
          matched_url: string | null
          price: number | null
          query_used: string | null
          raw_snippet: string | null
          source: string
        }
        Insert: {
          cache_key: string
          cost_aud?: number
          created_at?: string
          description?: string | null
          expires_at: string
          found: boolean
          hit_count?: number
          image_url?: string | null
          matched_url?: string | null
          price?: number | null
          query_used?: string | null
          raw_snippet?: string | null
          source: string
        }
        Update: {
          cache_key?: string
          cost_aud?: number
          created_at?: string
          description?: string | null
          expires_at?: string
          found?: boolean
          hit_count?: number
          image_url?: string | null
          matched_url?: string | null
          price?: number | null
          query_used?: string | null
          raw_snippet?: string | null
          source?: string
        }
        Relationships: []
      }
      shared_fingerprint_index: {
        Row: {
          column_map: Json
          created_at: string
          format_type: string | null
          id: string
          last_seen: string
          layout_fingerprint: string
          match_count: number
          price_logic: Json
          size_system: string | null
        }
        Insert: {
          column_map?: Json
          created_at?: string
          format_type?: string | null
          id?: string
          last_seen?: string
          layout_fingerprint: string
          match_count?: number
          price_logic?: Json
          size_system?: string | null
        }
        Update: {
          column_map?: Json
          created_at?: string
          format_type?: string | null
          id?: string
          last_seen?: string
          layout_fingerprint?: string
          match_count?: number
          price_logic?: Json
          size_system?: string | null
        }
        Relationships: []
      }
      shared_patterns: {
        Row: {
          avg_confidence: number | null
          column_roles: Json
          contributor_count: number
          created_at: string
          format_type: string | null
          gst_included_in_cost: boolean | null
          gst_included_in_rrp: boolean | null
          header_fingerprint: string | null
          id: string
          last_aggregated_at: string
          markup_avg: number | null
          markup_max: number | null
          markup_min: number | null
          pack_notation_detected: boolean | null
          size_matrix_detected: boolean | null
          size_system: string | null
          total_invoices: number
        }
        Insert: {
          avg_confidence?: number | null
          column_roles?: Json
          contributor_count?: number
          created_at?: string
          format_type?: string | null
          gst_included_in_cost?: boolean | null
          gst_included_in_rrp?: boolean | null
          header_fingerprint?: string | null
          id?: string
          last_aggregated_at?: string
          markup_avg?: number | null
          markup_max?: number | null
          markup_min?: number | null
          pack_notation_detected?: boolean | null
          size_matrix_detected?: boolean | null
          size_system?: string | null
          total_invoices?: number
        }
        Update: {
          avg_confidence?: number | null
          column_roles?: Json
          contributor_count?: number
          created_at?: string
          format_type?: string | null
          gst_included_in_cost?: boolean | null
          gst_included_in_rrp?: boolean | null
          header_fingerprint?: string | null
          id?: string
          last_aggregated_at?: string
          markup_avg?: number | null
          markup_max?: number | null
          markup_min?: number | null
          pack_notation_detected?: boolean | null
          size_matrix_detected?: boolean | null
          size_system?: string | null
          total_invoices?: number
        }
        Relationships: []
      }
      shared_supplier_profiles: {
        Row: {
          avg_correction_rate: number | null
          colour_in_name: boolean | null
          column_map: Json
          confidence_score: number | null
          contributing_users: number
          created_at: string
          detected_pattern: string | null
          gst_treatment: string | null
          has_rrp: boolean | null
          id: string
          is_verified: boolean
          last_updated: string
          size_in_sku: boolean | null
          sku_format: string | null
          supplier_abn: string | null
          supplier_name: string
          supplier_name_normalized: string
          total_invoices_processed: number
        }
        Insert: {
          avg_correction_rate?: number | null
          colour_in_name?: boolean | null
          column_map?: Json
          confidence_score?: number | null
          contributing_users?: number
          created_at?: string
          detected_pattern?: string | null
          gst_treatment?: string | null
          has_rrp?: boolean | null
          id?: string
          is_verified?: boolean
          last_updated?: string
          size_in_sku?: boolean | null
          sku_format?: string | null
          supplier_abn?: string | null
          supplier_name: string
          supplier_name_normalized: string
          total_invoices_processed?: number
        }
        Update: {
          avg_correction_rate?: number | null
          colour_in_name?: boolean | null
          column_map?: Json
          confidence_score?: number | null
          contributing_users?: number
          created_at?: string
          detected_pattern?: string | null
          gst_treatment?: string | null
          has_rrp?: boolean | null
          id?: string
          is_verified?: boolean
          last_updated?: string
          size_in_sku?: boolean | null
          sku_format?: string | null
          supplier_abn?: string | null
          supplier_name?: string
          supplier_name_normalized?: string
          total_invoices_processed?: number
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
          needs_reauth: boolean
          product_status: string
          refresh_token: string | null
          refresh_token_expires_at: string | null
          shop_name: string | null
          store_url: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          api_version?: string
          created_at?: string
          default_location_id?: string | null
          id?: string
          needs_reauth?: boolean
          product_status?: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          shop_name?: string | null
          store_url: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          api_version?: string
          created_at?: string
          default_location_id?: string | null
          id?: string
          needs_reauth?: boolean
          product_status?: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          shop_name?: string | null
          store_url?: string
          token_expires_at?: string | null
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
      shopify_token_migration_log: {
        Row: {
          attempted_at: string
          error_message: string | null
          id: string
          shop_domain: string
          status: string
          trigger_source: string
          user_id: string
        }
        Insert: {
          attempted_at?: string
          error_message?: string | null
          id?: string
          shop_domain: string
          status: string
          trigger_source?: string
          user_id: string
        }
        Update: {
          attempted_at?: string
          error_message?: string | null
          id?: string
          shop_domain?: string
          status?: string
          trigger_source?: string
          user_id?: string
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          adjusted_by: string | null
          adjustment_date: string
          adjustment_number: string
          applied_at: string | null
          created_at: string
          id: string
          line_items: Json
          location: string
          notes: string | null
          reason: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          adjusted_by?: string | null
          adjustment_date?: string
          adjustment_number: string
          applied_at?: string | null
          created_at?: string
          id?: string
          line_items?: Json
          location: string
          notes?: string | null
          reason: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          adjusted_by?: string | null
          adjustment_date?: string
          adjustment_number?: string
          applied_at?: string | null
          created_at?: string
          id?: string
          line_items?: Json
          location?: string
          notes?: string | null
          reason?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stock_snapshots: {
        Row: {
          created_at: string
          id: string
          location_filter: string | null
          snapshot_date: string
          total_cost_value: number
          total_retail_value: number
          total_skus: number
          total_units: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_filter?: string | null
          snapshot_date?: string
          total_cost_value?: number
          total_retail_value?: number
          total_skus?: number
          total_units?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_filter?: string | null
          snapshot_date?: string
          total_cost_value?: number
          total_retail_value?: number
          total_skus?: number
          total_units?: number
          user_id?: string
        }
        Relationships: []
      }
      stocktake_lines: {
        Row: {
          barcode: string | null
          counted_qty: number
          created_at: string
          expected_qty: number
          id: string
          product_title: string | null
          shopify_variant_id: string | null
          sku: string | null
          stocktake_id: string
          user_id: string
          variance: number | null
        }
        Insert: {
          barcode?: string | null
          counted_qty?: number
          created_at?: string
          expected_qty?: number
          id?: string
          product_title?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          stocktake_id: string
          user_id: string
          variance?: number | null
        }
        Update: {
          barcode?: string | null
          counted_qty?: number
          created_at?: string
          expected_qty?: number
          id?: string
          product_title?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          stocktake_id?: string
          user_id?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_lines_stocktake_id_fkey"
            columns: ["stocktake_id"]
            isOneToOne: false
            referencedRelation: "stocktakes"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktakes: {
        Row: {
          counted_at: string
          created_at: string
          id: string
          location: string
          notes: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          counted_at?: string
          created_at?: string
          id?: string
          location?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          counted_at?: string
          created_at?: string
          id?: string
          location?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      supplier_catalog_items: {
        Row: {
          barcode: string | null
          color: string | null
          cost: number
          created_at: string
          id: string
          is_archived: boolean
          lead_time_days: number
          min_order_qty: number
          notes: string | null
          product_name: string
          shopify_variant_id: string | null
          size: string | null
          sku: string | null
          supplier_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          cost?: number
          created_at?: string
          id?: string
          is_archived?: boolean
          lead_time_days?: number
          min_order_qty?: number
          notes?: string | null
          product_name?: string
          shopify_variant_id?: string | null
          size?: string | null
          sku?: string | null
          supplier_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          barcode?: string | null
          color?: string | null
          cost?: number
          created_at?: string
          id?: string
          is_archived?: boolean
          lead_time_days?: number
          min_order_qty?: number
          notes?: string | null
          product_name?: string
          shopify_variant_id?: string | null
          size?: string | null
          sku?: string | null
          supplier_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_catalog_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_intelligence: {
        Row: {
          column_map: Json
          confidence_score: number
          created_at: string
          detected_pattern: string | null
          gst_on_cost: boolean | null
          gst_on_rrp: boolean | null
          id: string
          invoice_count: number
          is_shared_origin: boolean
          last_correction_rate: number | null
          last_invoice_date: string | null
          last_match_method: string | null
          markup_multiplier: number | null
          name_variants: string[]
          size_system: string | null
          sku_prefix_pattern: string | null
          supplier_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          column_map?: Json
          confidence_score?: number
          created_at?: string
          detected_pattern?: string | null
          gst_on_cost?: boolean | null
          gst_on_rrp?: boolean | null
          id?: string
          invoice_count?: number
          is_shared_origin?: boolean
          last_correction_rate?: number | null
          last_invoice_date?: string | null
          last_match_method?: string | null
          markup_multiplier?: number | null
          name_variants?: string[]
          size_system?: string | null
          sku_prefix_pattern?: string | null
          supplier_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          column_map?: Json
          confidence_score?: number
          created_at?: string
          detected_pattern?: string | null
          gst_on_cost?: boolean | null
          gst_on_rrp?: boolean | null
          id?: string
          invoice_count?: number
          is_shared_origin?: boolean
          last_correction_rate?: number | null
          last_invoice_date?: string | null
          last_match_method?: string | null
          markup_multiplier?: number | null
          name_variants?: string[]
          size_system?: string | null
          sku_prefix_pattern?: string | null
          supplier_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      supplier_learning_log: {
        Row: {
          confidence_after: number | null
          confidence_before: number | null
          created_at: string
          details: Json
          event_type: string
          id: string
          match_method: string | null
          supplier_name: string
          user_id: string
        }
        Insert: {
          confidence_after?: number | null
          confidence_before?: number | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          match_method?: string | null
          supplier_name: string
          user_id: string
        }
        Update: {
          confidence_after?: number | null
          confidence_before?: number | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          match_method?: string | null
          supplier_name?: string
          user_id?: string
        }
        Relationships: []
      }
      supplier_profiles: {
        Row: {
          auto_publish_eligible: boolean | null
          confidence_score: number | null
          correction_rate: number | null
          country: string | null
          created_at: string
          currency: string | null
          email_domains: string[] | null
          id: string
          invoice_count: number | null
          invoices_analysed: number
          is_active: boolean
          is_known_brand: boolean | null
          last_invoice_date: string | null
          profile_data: Json
          supplier_name: string
          supplier_name_variants: string[] | null
          updated_at: string
          user_id: string
          website_last_scraped_at: string | null
          website_pricing_enabled: boolean
          website_products_cached: number
          website_scraper_type: string
          website_url: string | null
        }
        Insert: {
          auto_publish_eligible?: boolean | null
          confidence_score?: number | null
          correction_rate?: number | null
          country?: string | null
          created_at?: string
          currency?: string | null
          email_domains?: string[] | null
          id?: string
          invoice_count?: number | null
          invoices_analysed?: number
          is_active?: boolean
          is_known_brand?: boolean | null
          last_invoice_date?: string | null
          profile_data?: Json
          supplier_name: string
          supplier_name_variants?: string[] | null
          updated_at?: string
          user_id: string
          website_last_scraped_at?: string | null
          website_pricing_enabled?: boolean
          website_products_cached?: number
          website_scraper_type?: string
          website_url?: string | null
        }
        Update: {
          auto_publish_eligible?: boolean | null
          confidence_score?: number | null
          correction_rate?: number | null
          country?: string | null
          created_at?: string
          currency?: string | null
          email_domains?: string[] | null
          id?: string
          invoice_count?: number | null
          invoices_analysed?: number
          is_active?: boolean
          is_known_brand?: boolean | null
          last_invoice_date?: string | null
          profile_data?: Json
          supplier_name?: string
          supplier_name_variants?: string[] | null
          updated_at?: string
          user_id?: string
          website_last_scraped_at?: string | null
          website_pricing_enabled?: boolean
          website_products_cached?: number
          website_scraper_type?: string
          website_url?: string | null
        }
        Relationships: []
      }
      supplier_templates: {
        Row: {
          column_mappings: Json
          created_at: string
          error_count: number
          file_type: string
          header_row: number
          id: string
          notes: string | null
          regex_patterns: Json
          success_count: number
          supplier_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          column_mappings?: Json
          created_at?: string
          error_count?: number
          file_type?: string
          header_row?: number
          id?: string
          notes?: string | null
          regex_patterns?: Json
          success_count?: number
          supplier_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          column_mappings?: Json
          created_at?: string
          error_count?: number
          file_type?: string
          header_row?: number
          id?: string
          notes?: string | null
          regex_patterns?: Json
          success_count?: number
          supplier_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      supplier_website_prices: {
        Row: {
          colour: string | null
          compare_at_price: number | null
          currency: string
          handle: string | null
          id: string
          price: number
          product_title: string | null
          product_url: string | null
          scraped_at: string
          size: string | null
          supplier_profile_id: string
          user_id: string
        }
        Insert: {
          colour?: string | null
          compare_at_price?: number | null
          currency?: string
          handle?: string | null
          id?: string
          price: number
          product_title?: string | null
          product_url?: string | null
          scraped_at?: string
          size?: string | null
          supplier_profile_id: string
          user_id: string
        }
        Update: {
          colour?: string | null
          compare_at_price?: number | null
          currency?: string
          handle?: string | null
          id?: string
          price?: number
          product_title?: string | null
          product_url?: string | null
          scraped_at?: string
          size?: string | null
          supplier_profile_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_website_prices_supplier_profile_id_fkey"
            columns: ["supplier_profile_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_websites: {
        Row: {
          brand_name_display: string
          brand_name_normalised: string
          cache_ttl_hours: number
          canonical_brand_name: string | null
          country_origin: string | null
          created_at: string
          enrichment_enabled: boolean
          id: string
          is_shopify: boolean
          last_modified_by: string
          last_scraped_at: string | null
          notes: string | null
          product_categories: string | null
          products_json_endpoint: string | null
          scrape_failure_count: number
          source_sheet_row_id: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          brand_name_display: string
          brand_name_normalised: string
          cache_ttl_hours?: number
          canonical_brand_name?: string | null
          country_origin?: string | null
          created_at?: string
          enrichment_enabled?: boolean
          id?: string
          is_shopify?: boolean
          last_modified_by?: string
          last_scraped_at?: string | null
          notes?: string | null
          product_categories?: string | null
          products_json_endpoint?: string | null
          scrape_failure_count?: number
          source_sheet_row_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          brand_name_display?: string
          brand_name_normalised?: string
          cache_ttl_hours?: number
          canonical_brand_name?: string | null
          country_origin?: string | null
          created_at?: string
          enrichment_enabled?: boolean
          id?: string
          is_shopify?: boolean
          last_modified_by?: string
          last_scraped_at?: string | null
          notes?: string | null
          product_categories?: string | null
          products_json_endpoint?: string | null
          scrape_failure_count?: number
          source_sheet_row_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      supplier_websites_sync_log: {
        Row: {
          duration_ms: number | null
          error_text: string | null
          id: string
          rows_failed: number | null
          rows_in_sheet: number | null
          rows_skipped_db_newer: number | null
          rows_skipped_no_change: number | null
          rows_upserted: number | null
          run_at: string
          sheet_url: string | null
          source: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error_text?: string | null
          id?: string
          rows_failed?: number | null
          rows_in_sheet?: number | null
          rows_skipped_db_newer?: number | null
          rows_skipped_no_change?: number | null
          rows_upserted?: number | null
          run_at?: string
          sheet_url?: string | null
          source: string
          status?: string
        }
        Update: {
          duration_ms?: number | null
          error_text?: string | null
          id?: string
          rows_failed?: number | null
          rows_in_sheet?: number | null
          rows_skipped_db_newer?: number | null
          rows_skipped_no_change?: number | null
          rows_upserted?: number | null
          run_at?: string
          sheet_url?: string | null
          source?: string
          status?: string
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
      transfer_order_lines: {
        Row: {
          barcode: string | null
          created_at: string
          id: string
          product_title: string | null
          quantity: number
          received_qty: number
          shipped_qty: number
          shopify_inventory_item_id: string | null
          shopify_variant_id: string | null
          sku: string | null
          transfer_order_id: string
          user_id: string
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          id?: string
          product_title?: string | null
          quantity?: number
          received_qty?: number
          shipped_qty?: number
          shopify_inventory_item_id?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          transfer_order_id: string
          user_id: string
        }
        Update: {
          barcode?: string | null
          created_at?: string
          id?: string
          product_title?: string | null
          quantity?: number
          received_qty?: number
          shipped_qty?: number
          shopify_inventory_item_id?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          transfer_order_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_order_lines_transfer_order_id_fkey"
            columns: ["transfer_order_id"]
            isOneToOne: false
            referencedRelation: "transfer_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_orders: {
        Row: {
          created_at: string
          expected_ship_date: string | null
          from_location: string
          from_location_id: string | null
          id: string
          notes: string | null
          status: string
          to_location: string
          to_location_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expected_ship_date?: string | null
          from_location: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          status?: string
          to_location: string
          to_location_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expected_ship_date?: string | null
          from_location?: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          status?: string
          to_location?: string
          to_location_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_brain_settings: {
        Row: {
          contribute_shared: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          contribute_shared?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          contribute_shared?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          contribute_to_shared_learning: boolean
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contribute_to_shared_learning?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contribute_to_shared_learning?: boolean
          created_at?: string
          id?: string
          updated_at?: string
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
          role?: Database["public"]["Enums"]["app_role"]
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
      user_settings: {
        Row: {
          automation_auto_extract: boolean
          automation_auto_publish: boolean
          automation_email_monitoring: boolean
          automation_min_confidence: number
          brand_sync_url: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          automation_auto_extract?: boolean
          automation_auto_publish?: boolean
          automation_email_monitoring?: boolean
          automation_min_confidence?: number
          brand_sync_url?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          automation_auto_extract?: boolean
          automation_auto_publish?: boolean
          automation_email_monitoring?: boolean
          automation_min_confidence?: number
          brand_sync_url?: string | null
          created_at?: string
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
      websearch_usage_log: {
        Row: {
          cache_hit: boolean
          cost_aud: number
          created_at: string
          id: number
          matched_url: string | null
          query: string
          source: string
          user_id: string
        }
        Insert: {
          cache_hit?: boolean
          cost_aud?: number
          created_at?: string
          id?: number
          matched_url?: string | null
          query: string
          source: string
          user_id: string
        }
        Update: {
          cache_hit?: boolean
          cost_aud?: number
          created_at?: string
          id?: number
          matched_url?: string | null
          query?: string
          source?: string
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
      get_brand_rules_text: { Args: { _supplier: string }; Returns: string }
      get_supplier_hints: {
        Args: { _limit?: number; _supplier: string; _user_id: string }
        Returns: string
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalise_vendor: { Args: { raw: string }; Returns: string }
      reset_agent_budgets_monthly: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "buyer" | "warehouse" | "viewer"
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
    Enums: {
      app_role: ["admin", "buyer", "warehouse", "viewer"],
    },
  },
} as const
