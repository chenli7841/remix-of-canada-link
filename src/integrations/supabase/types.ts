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
      addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          destination_code: string | null
          id: string
          is_default: boolean
          line1: string
          line2: string | null
          phone: string
          postal_code: string
          province: string
          recipient: string
          updated_at: string
          user_id: string
        }
        Insert: {
          city: string
          country?: string
          created_at?: string
          destination_code?: string | null
          id?: string
          is_default?: boolean
          line1: string
          line2?: string | null
          phone: string
          postal_code: string
          province: string
          recipient: string
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          destination_code?: string | null
          id?: string
          is_default?: boolean
          line1?: string
          line2?: string | null
          phone?: string
          postal_code?: string
          province?: string
          recipient?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_action_logs: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          note: string | null
          operator_id: string | null
          operator_name: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          note?: string | null
          operator_id?: string | null
          operator_name?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          note?: string | null
          operator_id?: string | null
          operator_name?: string | null
        }
        Relationships: []
      }
      admin_nav_items: {
        Row: {
          group_sort_order: number
          group_title: string
          icon: string
          id: string
          item_sort_order: number
          label: string
          path: string
          roles: string[]
          updated_at: string
        }
        Insert: {
          group_sort_order?: number
          group_title?: string
          icon: string
          id?: string
          item_sort_order?: number
          label: string
          path: string
          roles?: string[]
          updated_at?: string
        }
        Update: {
          group_sort_order?: number
          group_title?: string
          icon?: string
          id?: string
          item_sort_order?: number
          label?: string
          path?: string
          roles?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      ai_forwarding_drafts: {
        Row: {
          confirmed_at: string | null
          created_at: string
          draft_data: Json
          expires_at: string
          forwarding_id: string | null
          id: string
          request_no: string | null
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          draft_data?: Json
          expires_at?: string
          forwarding_id?: string | null
          id?: string
          request_no?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          draft_data?: Json
          expires_at?: string
          forwarding_id?: string | null
          id?: string
          request_no?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_forwarding_drafts_forwarding_id_fkey"
            columns: ["forwarding_id"]
            isOneToOne: false
            referencedRelation: "forwarding_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_forwarding_requests: {
        Row: {
          created_at: string
          domestic_tracking_no: string | null
          forwarding_id: string | null
          id: string
          idempotency_key: string
          payload: Json | null
          request_no: string | null
          source: string
          user_id: string
          visitor_biz_id: string
        }
        Insert: {
          created_at?: string
          domestic_tracking_no?: string | null
          forwarding_id?: string | null
          id?: string
          idempotency_key: string
          payload?: Json | null
          request_no?: string | null
          source?: string
          user_id: string
          visitor_biz_id: string
        }
        Update: {
          created_at?: string
          domestic_tracking_no?: string | null
          forwarding_id?: string | null
          id?: string
          idempotency_key?: string
          payload?: Json | null
          request_no?: string | null
          source?: string
          user_id?: string
          visitor_biz_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_forwarding_requests_forwarding_id_fkey"
            columns: ["forwarding_id"]
            isOneToOne: false
            referencedRelation: "forwarding_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_support_messages: {
        Row: {
          body: string
          created_at: string
          customer_user_id: string
          id: string
          read_by_customer_at: string | null
          read_by_staff_at: string | null
          sender_role: string
          sender_user_id: string | null
          source: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          customer_user_id: string
          id?: string
          read_by_customer_at?: string | null
          read_by_staff_at?: string | null
          sender_role: string
          sender_user_id?: string | null
          source?: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          customer_user_id?: string
          id?: string
          read_by_customer_at?: string | null
          read_by_staff_at?: string | null
          sender_role?: string
          sender_user_id?: string | null
          source?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_support_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_support_threads: {
        Row: {
          created_at: string
          customer_code: string
          customer_user_id: string
          id: string
          last_message_at: string
          unread_for_customer: number
          unread_for_staff: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_code: string
          customer_user_id: string
          id?: string
          last_message_at?: string
          unread_for_customer?: number
          unread_for_staff?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_code?: string
          customer_user_id?: string
          id?: string
          last_message_at?: string
          unread_for_customer?: number
          unread_for_staff?: number
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      batch_settlements: {
        Row: {
          batch_id: string
          calc_version: number
          carton_count: number | null
          confirmed: boolean
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          customer_code: string
          fee_breakdown: Json | null
          id: string
          is_paid: boolean
          paid_at: string | null
          pallet_count: number | null
          route_codes: string | null
          snapshot_at: string | null
          subtotal_cad: number | null
          updated_at: string
          waybill_count: number | null
        }
        Insert: {
          batch_id: string
          calc_version?: number
          carton_count?: number | null
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_code: string
          fee_breakdown?: Json | null
          id?: string
          is_paid?: boolean
          paid_at?: string | null
          pallet_count?: number | null
          route_codes?: string | null
          snapshot_at?: string | null
          subtotal_cad?: number | null
          updated_at?: string
          waybill_count?: number | null
        }
        Update: {
          batch_id?: string
          calc_version?: number
          carton_count?: number | null
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_code?: string
          fee_breakdown?: Json | null
          id?: string
          is_paid?: boolean
          paid_at?: string | null
          pallet_count?: number | null
          route_codes?: string | null
          snapshot_at?: string | null
          subtotal_cad?: number | null
          updated_at?: string
          waybill_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_settlements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          actual_ship_date: string | null
          batch_no: string | null
          cargo_type: string | null
          closed_at: string | null
          container_no: string | null
          created_at: string
          created_by: string | null
          customs_consignee: Json | null
          customs_shipper: Json | null
          destination_code: string | null
          destination_codes: string[]
          display_name: string | null
          eta_date: string | null
          fee_breakdown: Json | null
          fees_dirty_at: string | null
          grand_total_cny: number
          hbl_extracted: Json | null
          hbl_file_name: string | null
          hbl_file_path: string | null
          hbl_goods_description: string | null
          hbl_total_volume_m3: number | null
          hbl_total_weight_kg: number | null
          id: string
          notes: string | null
          planned_ship_date: string
          sequence_no: number | null
          shipping_method: Database["public"]["Enums"]["batch_method"]
          status: Database["public"]["Enums"]["batch_status"]
          total_cny: number | null
          total_volume_cm3: number | null
          total_weight_kg: number | null
          updated_at: string
          vessel_no: string | null
          waybill_count: number | null
        }
        Insert: {
          actual_ship_date?: string | null
          batch_no?: string | null
          cargo_type?: string | null
          closed_at?: string | null
          container_no?: string | null
          created_at?: string
          created_by?: string | null
          customs_consignee?: Json | null
          customs_shipper?: Json | null
          destination_code?: string | null
          destination_codes?: string[]
          display_name?: string | null
          eta_date?: string | null
          fee_breakdown?: Json | null
          fees_dirty_at?: string | null
          grand_total_cny?: number
          hbl_extracted?: Json | null
          hbl_file_name?: string | null
          hbl_file_path?: string | null
          hbl_goods_description?: string | null
          hbl_total_volume_m3?: number | null
          hbl_total_weight_kg?: number | null
          id?: string
          notes?: string | null
          planned_ship_date: string
          sequence_no?: number | null
          shipping_method: Database["public"]["Enums"]["batch_method"]
          status?: Database["public"]["Enums"]["batch_status"]
          total_cny?: number | null
          total_volume_cm3?: number | null
          total_weight_kg?: number | null
          updated_at?: string
          vessel_no?: string | null
          waybill_count?: number | null
        }
        Update: {
          actual_ship_date?: string | null
          batch_no?: string | null
          cargo_type?: string | null
          closed_at?: string | null
          container_no?: string | null
          created_at?: string
          created_by?: string | null
          customs_consignee?: Json | null
          customs_shipper?: Json | null
          destination_code?: string | null
          destination_codes?: string[]
          display_name?: string | null
          eta_date?: string | null
          fee_breakdown?: Json | null
          fees_dirty_at?: string | null
          grand_total_cny?: number
          hbl_extracted?: Json | null
          hbl_file_name?: string | null
          hbl_file_path?: string | null
          hbl_goods_description?: string | null
          hbl_total_volume_m3?: number | null
          hbl_total_weight_kg?: number | null
          id?: string
          notes?: string | null
          planned_ship_date?: string
          sequence_no?: number | null
          shipping_method?: Database["public"]["Enums"]["batch_method"]
          status?: Database["public"]["Enums"]["batch_status"]
          total_cny?: number | null
          total_volume_cm3?: number | null
          total_weight_kg?: number | null
          updated_at?: string
          vessel_no?: string | null
          waybill_count?: number | null
        }
        Relationships: []
      }
      cargo_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name_en: string | null
          name_zh: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name_en?: string | null
          name_zh: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name_en?: string | null
          name_zh?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      cartons: {
        Row: {
          address_snapshot: Json | null
          batch_id: string | null
          carton_no: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          customer_code: string | null
          customer_user_id: string | null
          destination_code: string | null
          display_name: string | null
          height_cm: number | null
          id: string
          length_cm: number | null
          notes: string | null
          pallet_id: string | null
          pickup_warehouse: string | null
          route_code: string | null
          route_id: string | null
          self_freight_cad: number
          self_freight_cny: number
          self_height_cm: number | null
          self_length_cm: number | null
          self_volume_m3: number | null
          self_weight_kg: number | null
          self_width_cm: number | null
          sequence_no: number | null
          status: string
          unlocked: boolean
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          address_snapshot?: Json | null
          batch_id?: string | null
          carton_no?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_user_id?: string | null
          destination_code?: string | null
          display_name?: string | null
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          notes?: string | null
          pallet_id?: string | null
          pickup_warehouse?: string | null
          route_code?: string | null
          route_id?: string | null
          self_freight_cad?: number
          self_freight_cny?: number
          self_height_cm?: number | null
          self_length_cm?: number | null
          self_volume_m3?: number | null
          self_weight_kg?: number | null
          self_width_cm?: number | null
          sequence_no?: number | null
          status?: string
          unlocked?: boolean
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          address_snapshot?: Json | null
          batch_id?: string | null
          carton_no?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_user_id?: string | null
          destination_code?: string | null
          display_name?: string | null
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          notes?: string | null
          pallet_id?: string | null
          pickup_warehouse?: string | null
          route_code?: string | null
          route_id?: string | null
          self_freight_cad?: number
          self_freight_cny?: number
          self_height_cm?: number | null
          self_length_cm?: number | null
          self_volume_m3?: number | null
          self_weight_kg?: number | null
          self_width_cm?: number | null
          sequence_no?: number | null
          status?: string
          unlocked?: boolean
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cartons_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cartons_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cartons_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "shipping_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_articles: {
        Row: {
          author_id: string | null
          content_md: string | null
          cover_url: string | null
          created_at: string
          excerpt: string | null
          id: string
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["cms_status"]
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          content_md?: string | null
          cover_url?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["cms_status"]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          content_md?: string | null
          cover_url?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["cms_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      cms_banners: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          image_url: string
          is_active: boolean
          link_url: string | null
          position: string
          sort_order: number
          starts_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          image_url: string
          is_active?: boolean
          link_url?: string | null
          position?: string
          sort_order?: number
          starts_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          image_url?: string
          is_active?: boolean
          link_url?: string | null
          position?: string
          sort_order?: number
          starts_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          phone?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string | null
          status?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          id: string
          order_id: string | null
          redeemed_at: string
          user_id: string
        }
        Insert: {
          coupon_id: string
          id?: string
          order_id?: string | null
          redeemed_at?: string
          user_id: string
        }
        Update: {
          coupon_id?: string
          id?: string
          order_id?: string | null
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          min_order_cny: number
          name: string | null
          starts_at: string | null
          type: Database["public"]["Enums"]["coupon_type"]
          updated_at: string
          usage_limit: number | null
          used_count: number
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          min_order_cny?: number
          name?: string | null
          starts_at?: string | null
          type?: Database["public"]["Enums"]["coupon_type"]
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          value?: number
        }
        Update: {
          code?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          min_order_cny?: number
          name?: string | null
          starts_at?: string | null
          type?: Database["public"]["Enums"]["coupon_type"]
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          value?: number
        }
        Relationships: []
      }
      customer_hs_items: {
        Row: {
          brand: string | null
          created_at: string
          ctns: number | null
          description: string
          hs_code: string | null
          id: string
          items_per_carton: number | null
          material: string | null
          note: string | null
          origin: string | null
          sku: string | null
          unit_price_cad: number | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          ctns?: number | null
          description: string
          hs_code?: string | null
          id?: string
          items_per_carton?: number | null
          material?: string | null
          note?: string | null
          origin?: string | null
          sku?: string | null
          unit_price_cad?: number | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          ctns?: number | null
          description?: string
          hs_code?: string | null
          id?: string
          items_per_carton?: number | null
          material?: string | null
          note?: string | null
          origin?: string | null
          sku?: string | null
          unit_price_cad?: number | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      customs_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          note: string | null
          rate_pct: number
          route_id: string
          threshold_cad: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          note?: string | null
          rate_pct?: number
          route_id: string
          threshold_cad?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          note?: string | null
          rate_pct?: number
          route_id?: string
          threshold_cad?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customs_rules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: true
            referencedRelation: "shipping_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_queue: {
        Row: {
          added_by: string | null
          code: string
          created_at: string
          customer_code: string | null
          customer_user_id: string | null
          dispatched_at: string | null
          id: string
          kind: string
          notes: string | null
          ref_id: string
          source_batch_id: string | null
          source_receiving_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          code: string
          created_at?: string
          customer_code?: string | null
          customer_user_id?: string | null
          dispatched_at?: string | null
          id?: string
          kind: string
          notes?: string | null
          ref_id: string
          source_batch_id?: string | null
          source_receiving_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          code?: string
          created_at?: string
          customer_code?: string | null
          customer_user_id?: string | null
          dispatched_at?: string | null
          id?: string
          kind?: string
          notes?: string | null
          ref_id?: string
          source_batch_id?: string | null
          source_receiving_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_queue_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_queue_source_receiving_id_fkey"
            columns: ["source_receiving_id"]
            isOneToOne: false
            referencedRelation: "receivings"
            referencedColumns: ["id"]
          },
        ]
      }
      destinations: {
        Row: {
          active: boolean
          code: string
          country: string | null
          created_at: string
          id: string
          name_en: string | null
          name_zh: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          country?: string | null
          created_at?: string
          id?: string
          name_en?: string | null
          name_zh: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          country?: string | null
          created_at?: string
          id?: string
          name_en?: string | null
          name_zh?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      detained_packages: {
        Row: {
          created_at: string
          created_by: string | null
          customer_code: string | null
          domestic_tracking_no: string
          id: string
          intake_parent_id: string | null
          intake_parent_kind: string | null
          intake_waybill_ids: string[] | null
          note: string | null
          released_at: string | null
          released_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          domestic_tracking_no: string
          id?: string
          intake_parent_id?: string | null
          intake_parent_kind?: string | null
          intake_waybill_ids?: string[] | null
          note?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          domestic_tracking_no?: string
          id?: string
          intake_parent_id?: string | null
          intake_parent_kind?: string | null
          intake_waybill_ids?: string[] | null
          note?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: string
        }
        Relationships: []
      }
      forwarding_items: {
        Row: {
          anti_dumping_rate: number | null
          box_count: number | null
          brand: string | null
          created_at: string
          declared_value_cad: number | null
          duty_cad: number | null
          extras: Json
          forwarding_id: string
          gst_rate: number | null
          hs_code: string | null
          hs_confirmed: boolean
          hs_matched: string | null
          id: string
          inner_qty: number | null
          material: string | null
          mfn_rate: number | null
          name: string
          origin: string | null
          quantity: number
          unit_price_cad: number
          unit_price_cny: number
        }
        Insert: {
          anti_dumping_rate?: number | null
          box_count?: number | null
          brand?: string | null
          created_at?: string
          declared_value_cad?: number | null
          duty_cad?: number | null
          extras?: Json
          forwarding_id: string
          gst_rate?: number | null
          hs_code?: string | null
          hs_confirmed?: boolean
          hs_matched?: string | null
          id?: string
          inner_qty?: number | null
          material?: string | null
          mfn_rate?: number | null
          name: string
          origin?: string | null
          quantity?: number
          unit_price_cad?: number
          unit_price_cny?: number
        }
        Update: {
          anti_dumping_rate?: number | null
          box_count?: number | null
          brand?: string | null
          created_at?: string
          declared_value_cad?: number | null
          duty_cad?: number | null
          extras?: Json
          forwarding_id?: string
          gst_rate?: number | null
          hs_code?: string | null
          hs_confirmed?: boolean
          hs_matched?: string | null
          id?: string
          inner_qty?: number | null
          material?: string | null
          mfn_rate?: number | null
          name?: string
          origin?: string | null
          quantity?: number
          unit_price_cad?: number
          unit_price_cny?: number
        }
        Relationships: [
          {
            foreignKeyName: "forwarding_items_forwarding_id_fkey"
            columns: ["forwarding_id"]
            isOneToOne: false
            referencedRelation: "forwarding_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      forwarding_orders: {
        Row: {
          actual_weight_kg: number | null
          address_id: string | null
          aliases: string[]
          batch_no: string | null
          box_count: number
          box_no: string | null
          carton_id: string | null
          company_code: string | null
          created_at: string
          customer_code: string | null
          customs_cny: number
          declared_value_cad: number | null
          destination_code: string | null
          domestic_tracking_no: string | null
          eta: string | null
          eta_label: string | null
          fee_cny: number | null
          freight_snapshot: Json | null
          height_cm: number | null
          id: string
          insurance_cny: number
          insured: boolean
          intake_at: string | null
          intake_by: string | null
          intl_tracking_no: string | null
          items_desc: string | null
          length_cm: number | null
          note: string | null
          pallet_id: string | null
          pallet_no: string | null
          payment_status: string
          request_no: string | null
          route_code: string | null
          route_id: string | null
          shipping_method: string
          status: string
          storage_fee_from: string | null
          tracking_no: string | null
          updated_at: string
          user_id: string
          warehouse: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          actual_weight_kg?: number | null
          address_id?: string | null
          aliases?: string[]
          batch_no?: string | null
          box_count?: number
          box_no?: string | null
          carton_id?: string | null
          company_code?: string | null
          created_at?: string
          customer_code?: string | null
          customs_cny?: number
          declared_value_cad?: number | null
          destination_code?: string | null
          domestic_tracking_no?: string | null
          eta?: string | null
          eta_label?: string | null
          fee_cny?: number | null
          freight_snapshot?: Json | null
          height_cm?: number | null
          id?: string
          insurance_cny?: number
          insured?: boolean
          intake_at?: string | null
          intake_by?: string | null
          intl_tracking_no?: string | null
          items_desc?: string | null
          length_cm?: number | null
          note?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_status?: string
          request_no?: string | null
          route_code?: string | null
          route_id?: string | null
          shipping_method: string
          status?: string
          storage_fee_from?: string | null
          tracking_no?: string | null
          updated_at?: string
          user_id: string
          warehouse: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          actual_weight_kg?: number | null
          address_id?: string | null
          aliases?: string[]
          batch_no?: string | null
          box_count?: number
          box_no?: string | null
          carton_id?: string | null
          company_code?: string | null
          created_at?: string
          customer_code?: string | null
          customs_cny?: number
          declared_value_cad?: number | null
          destination_code?: string | null
          domestic_tracking_no?: string | null
          eta?: string | null
          eta_label?: string | null
          fee_cny?: number | null
          freight_snapshot?: Json | null
          height_cm?: number | null
          id?: string
          insurance_cny?: number
          insured?: boolean
          intake_at?: string | null
          intake_by?: string | null
          intl_tracking_no?: string | null
          items_desc?: string | null
          length_cm?: number | null
          note?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_status?: string
          request_no?: string | null
          route_code?: string | null
          route_id?: string | null
          shipping_method?: string
          status?: string
          storage_fee_from?: string | null
          tracking_no?: string | null
          updated_at?: string
          user_id?: string
          warehouse?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forwarding_orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forwarding_orders_carton_id_fkey"
            columns: ["carton_id"]
            isOneToOne: false
            referencedRelation: "cartons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forwarding_orders_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forwarding_orders_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "shipping_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_rules: {
        Row: {
          clearance_fee_batch_cad: number
          clearance_fee_cad: number
          clearance_fee_level: string
          clearance_fee_waybill_cad: number
          created_at: string
          delivery_heavy_min_kg: number | null
          delivery_light_fee_cad: number | null
          delivery_light_max_kg: number | null
          delivery_unit_fee_cad: number | null
          direction: string
          effective_from: string | null
          effective_to: string | null
          extra_fee_cny: number
          id: string
          insurance_rate_pct: number
          is_active: boolean
          min_charge_batch_cad: number
          min_charge_cad: number
          min_charge_cny: number
          min_charge_level: string
          min_charge_waybill_cad: number
          note: string | null
          oversize_alert_length_cm: number | null
          overweight_alert_ratio: number | null
          pallet_max_height_cm: number | null
          pallet_max_length_cm: number | null
          pallet_max_weight_kg: number | null
          pallet_max_width_cm: number | null
          pallet_overflow_factor: number
          pallet_unit_price_cad: number
          pricing_mode: string
          remote_postal_prefixes: string | null
          route_id: string
          unit_price_cad: number
          unit_price_cny: number
          updated_at: string
          volumetric_divisor: number
          weight_mode: string
        }
        Insert: {
          clearance_fee_batch_cad?: number
          clearance_fee_cad?: number
          clearance_fee_level?: string
          clearance_fee_waybill_cad?: number
          created_at?: string
          delivery_heavy_min_kg?: number | null
          delivery_light_fee_cad?: number | null
          delivery_light_max_kg?: number | null
          delivery_unit_fee_cad?: number | null
          direction?: string
          effective_from?: string | null
          effective_to?: string | null
          extra_fee_cny?: number
          id?: string
          insurance_rate_pct?: number
          is_active?: boolean
          min_charge_batch_cad?: number
          min_charge_cad?: number
          min_charge_cny?: number
          min_charge_level?: string
          min_charge_waybill_cad?: number
          note?: string | null
          oversize_alert_length_cm?: number | null
          overweight_alert_ratio?: number | null
          pallet_max_height_cm?: number | null
          pallet_max_length_cm?: number | null
          pallet_max_weight_kg?: number | null
          pallet_max_width_cm?: number | null
          pallet_overflow_factor?: number
          pallet_unit_price_cad?: number
          pricing_mode?: string
          remote_postal_prefixes?: string | null
          route_id: string
          unit_price_cad?: number
          unit_price_cny?: number
          updated_at?: string
          volumetric_divisor?: number
          weight_mode?: string
        }
        Update: {
          clearance_fee_batch_cad?: number
          clearance_fee_cad?: number
          clearance_fee_level?: string
          clearance_fee_waybill_cad?: number
          created_at?: string
          delivery_heavy_min_kg?: number | null
          delivery_light_fee_cad?: number | null
          delivery_light_max_kg?: number | null
          delivery_unit_fee_cad?: number | null
          direction?: string
          effective_from?: string | null
          effective_to?: string | null
          extra_fee_cny?: number
          id?: string
          insurance_rate_pct?: number
          is_active?: boolean
          min_charge_batch_cad?: number
          min_charge_cad?: number
          min_charge_cny?: number
          min_charge_level?: string
          min_charge_waybill_cad?: number
          note?: string | null
          oversize_alert_length_cm?: number | null
          overweight_alert_ratio?: number | null
          pallet_max_height_cm?: number | null
          pallet_max_length_cm?: number | null
          pallet_max_weight_kg?: number | null
          pallet_max_width_cm?: number | null
          pallet_overflow_factor?: number
          pallet_unit_price_cad?: number
          pricing_mode?: string
          remote_postal_prefixes?: string | null
          route_id?: string
          unit_price_cad?: number
          unit_price_cny?: number
          updated_at?: string
          volumetric_divisor?: number
          weight_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "freight_rules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "shipping_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      hs_codes: {
        Row: {
          aliases: string[]
          anti_dumping_note: string | null
          anti_dumping_rate: number | null
          chapter: string | null
          contains_battery: boolean
          control_note: string | null
          created_at: string
          excise_note: string | null
          excise_rate: number
          gst_rate: number | null
          hs_code: string
          id: string
          import_control: string[]
          is_active: boolean
          is_hazmat: boolean
          material: string | null
          mfn_rate: number | null
          mfn_text: string | null
          name_en: string | null
          name_zh: string
          note: string | null
          origin: string | null
          parent_description: string | null
          requires_permit: boolean
          sima_involved: boolean
          surtax_note: string | null
          surtax_rate: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          anti_dumping_note?: string | null
          anti_dumping_rate?: number | null
          chapter?: string | null
          contains_battery?: boolean
          control_note?: string | null
          created_at?: string
          excise_note?: string | null
          excise_rate?: number
          gst_rate?: number | null
          hs_code: string
          id?: string
          import_control?: string[]
          is_active?: boolean
          is_hazmat?: boolean
          material?: string | null
          mfn_rate?: number | null
          mfn_text?: string | null
          name_en?: string | null
          name_zh: string
          note?: string | null
          origin?: string | null
          parent_description?: string | null
          requires_permit?: boolean
          sima_involved?: boolean
          surtax_note?: string | null
          surtax_rate?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          anti_dumping_note?: string | null
          anti_dumping_rate?: number | null
          chapter?: string | null
          contains_battery?: boolean
          control_note?: string | null
          created_at?: string
          excise_note?: string | null
          excise_rate?: number
          gst_rate?: number | null
          hs_code?: string
          id?: string
          import_control?: string[]
          is_active?: boolean
          is_hazmat?: boolean
          material?: string | null
          mfn_rate?: number | null
          mfn_text?: string | null
          name_en?: string | null
          name_zh?: string
          note?: string | null
          origin?: string | null
          parent_description?: string | null
          requires_permit?: boolean
          sima_involved?: boolean
          surtax_note?: string | null
          surtax_rate?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      hs_import_staging: {
        Row: {
          hs_code: string
          mfn_text: string | null
          parent_description: string | null
        }
        Insert: {
          hs_code: string
          mfn_text?: string | null
          parent_description?: string | null
        }
        Update: {
          hs_code?: string
          mfn_text?: string | null
          parent_description?: string | null
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          note: string | null
          operator_id: string | null
          qty_delta: number
          reason: Database["public"]["Enums"]["inv_reason"]
          ref_id: string | null
          ref_type: string | null
          variant_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          operator_id?: string | null
          qty_delta: number
          reason: Database["public"]["Enums"]["inv_reason"]
          ref_id?: string | null
          ref_type?: string | null
          variant_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          operator_id?: string | null
          qty_delta?: number
          reason?: Database["public"]["Enums"]["inv_reason"]
          ref_id?: string | null
          ref_type?: string | null
          variant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount_cny: number
          created_at: string
          customs_cny: number
          description: string
          forwarding_id: string | null
          freight_cny: number
          id: string
          insurance_cny: number
          invoice_id: string
          meta: Json | null
          order_id: string | null
          other_cny: number
          waybill_id: string | null
        }
        Insert: {
          amount_cny?: number
          created_at?: string
          customs_cny?: number
          description: string
          forwarding_id?: string | null
          freight_cny?: number
          id?: string
          insurance_cny?: number
          invoice_id: string
          meta?: Json | null
          order_id?: string | null
          other_cny?: number
          waybill_id?: string | null
        }
        Update: {
          amount_cny?: number
          created_at?: string
          customs_cny?: number
          description?: string
          forwarding_id?: string | null
          freight_cny?: number
          id?: string
          insurance_cny?: number
          invoice_id?: string
          meta?: Json | null
          order_id?: string | null
          other_cny?: number
          waybill_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_forwarding_id_fkey"
            columns: ["forwarding_id"]
            isOneToOne: false
            referencedRelation: "forwarding_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_waybill_id_fkey"
            columns: ["waybill_id"]
            isOneToOne: false
            referencedRelation: "waybills"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          batch_no: string | null
          created_at: string
          created_by: string | null
          currency: string
          customs_cny: number
          due_date: string | null
          freight_cny: number
          fx_rate: number
          id: string
          insurance_cny: number
          invoice_no: string
          note: string | null
          other_cny: number
          paid_at: string | null
          paid_cad: number
          paid_cny: number
          payment_method: string
          period_end: string | null
          period_start: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_cny: number
          total_cny: number
          type: Database["public"]["Enums"]["invoice_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          batch_no?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customs_cny?: number
          due_date?: string | null
          freight_cny?: number
          fx_rate?: number
          id?: string
          insurance_cny?: number
          invoice_no: string
          note?: string | null
          other_cny?: number
          paid_at?: string | null
          paid_cad?: number
          paid_cny?: number
          payment_method?: string
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_cny?: number
          total_cny?: number
          type?: Database["public"]["Enums"]["invoice_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          batch_no?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customs_cny?: number
          due_date?: string | null
          freight_cny?: number
          fx_rate?: number
          id?: string
          insurance_cny?: number
          invoice_no?: string
          note?: string | null
          other_cny?: number
          paid_at?: string | null
          paid_cad?: number
          paid_cny?: number
          payment_method?: string
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_cny?: number
          total_cny?: number
          type?: Database["public"]["Enums"]["invoice_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      my_items: {
        Row: {
          brand: string | null
          created_at: string
          declared_value_cad: number
          gst_rate: number
          hs_code: string
          id: string
          inner_qty: number | null
          material: string | null
          mfn_rate: number
          name: string
          origin: string | null
          sima_involved: boolean
          sku: string | null
          unit: string | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          declared_value_cad?: number
          gst_rate?: number
          hs_code: string
          id?: string
          inner_qty?: number | null
          material?: string | null
          mfn_rate?: number
          name: string
          origin?: string | null
          sima_involved?: boolean
          sku?: string | null
          unit?: string | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          declared_value_cad?: number
          gst_rate?: number
          hs_code?: string
          id?: string
          inner_qty?: number | null
          material?: string | null
          mfn_rate?: number
          name?: string
          origin?: string | null
          sima_involved?: boolean
          sku?: string | null
          unit?: string | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      offline_payments: {
        Row: {
          amount_cad: number
          attachment_url: string | null
          created_at: string
          id: string
          invoice_id: string
          method: string
          note: string | null
          paid_at: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount_cad: number
          attachment_url?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          method: string
          note?: string | null
          paid_at?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount_cad?: number
          attachment_url?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          method?: string
          note?: string | null
          paid_at?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      order_attachments: {
        Row: {
          content_type: string | null
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          id: string
          owner_id: string
          owner_kind: string
          user_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          owner_id: string
          owner_kind: string
          user_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          owner_id?: string
          owner_kind?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          anti_dumping_rate: number | null
          attrs_snapshot: Json | null
          created_at: string
          declared_value_cad: number | null
          duty_cad: number | null
          gst_rate: number | null
          hs_code: string | null
          hs_confirmed: boolean
          id: string
          image_url: string | null
          list_price_cny: number | null
          mfn_rate: number | null
          name_en: string | null
          name_zh: string
          order_id: string
          paid: boolean
          price_override_reason: string | null
          product_id: string | null
          product_slug: string
          purchase_type: string
          quantity: number
          sku: string | null
          subtotal_cny: number
          unit_price_cny: number
          variant_id: string | null
          waybill_id: string | null
        }
        Insert: {
          anti_dumping_rate?: number | null
          attrs_snapshot?: Json | null
          created_at?: string
          declared_value_cad?: number | null
          duty_cad?: number | null
          gst_rate?: number | null
          hs_code?: string | null
          hs_confirmed?: boolean
          id?: string
          image_url?: string | null
          list_price_cny?: number | null
          mfn_rate?: number | null
          name_en?: string | null
          name_zh: string
          order_id: string
          paid?: boolean
          price_override_reason?: string | null
          product_id?: string | null
          product_slug: string
          purchase_type?: string
          quantity: number
          sku?: string | null
          subtotal_cny?: number
          unit_price_cny: number
          variant_id?: string | null
          waybill_id?: string | null
        }
        Update: {
          anti_dumping_rate?: number | null
          attrs_snapshot?: Json | null
          created_at?: string
          declared_value_cad?: number | null
          duty_cad?: number | null
          gst_rate?: number | null
          hs_code?: string | null
          hs_confirmed?: boolean
          id?: string
          image_url?: string | null
          list_price_cny?: number | null
          mfn_rate?: number | null
          name_en?: string | null
          name_zh?: string
          order_id?: string
          paid?: boolean
          price_override_reason?: string | null
          product_id?: string | null
          product_slug?: string
          purchase_type?: string
          quantity?: number
          sku?: string | null
          subtotal_cny?: number
          unit_price_cny?: number
          variant_id?: string | null
          waybill_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_waybill_id_fkey"
            columns: ["waybill_id"]
            isOneToOne: false
            referencedRelation: "waybills"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_snapshot: Json | null
          aliases: string[]
          batch_no: string | null
          box_count: number
          box_no: string | null
          buyer_note: string | null
          carton_id: string | null
          company_code: string | null
          completed_at: string | null
          coupon_id: string | null
          created_at: string
          customer_code: string | null
          customs_cny: number
          destination_code: string | null
          discount_cny: number
          display_currency: string
          domestic_tracking_no: string | null
          eta: string | null
          freight_recalc_at: string | null
          freight_recalc_by: string | null
          freight_snapshot: Json | null
          fx_rate: number
          id: string
          insurance_cny: number
          insured: boolean
          intl_tracking_no: string | null
          note: string | null
          order_no: string
          overridden_by: string | null
          paid_at: string | null
          pallet_id: string | null
          pallet_no: string | null
          payment_method: string | null
          payment_status: string
          price_override_reason: string | null
          route_code: string | null
          route_id: string | null
          shipped_at: string | null
          shipping_cny: number
          shipping_method: string
          source: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cny: number
          total_cny: number
          tracking_no: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address_snapshot?: Json | null
          aliases?: string[]
          batch_no?: string | null
          box_count?: number
          box_no?: string | null
          buyer_note?: string | null
          carton_id?: string | null
          company_code?: string | null
          completed_at?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_code?: string | null
          customs_cny?: number
          destination_code?: string | null
          discount_cny?: number
          display_currency?: string
          domestic_tracking_no?: string | null
          eta?: string | null
          freight_recalc_at?: string | null
          freight_recalc_by?: string | null
          freight_snapshot?: Json | null
          fx_rate?: number
          id?: string
          insurance_cny?: number
          insured?: boolean
          intl_tracking_no?: string | null
          note?: string | null
          order_no: string
          overridden_by?: string | null
          paid_at?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_method?: string | null
          payment_status?: string
          price_override_reason?: string | null
          route_code?: string | null
          route_id?: string | null
          shipped_at?: string | null
          shipping_cny?: number
          shipping_method?: string
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cny?: number
          total_cny?: number
          tracking_no?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address_snapshot?: Json | null
          aliases?: string[]
          batch_no?: string | null
          box_count?: number
          box_no?: string | null
          buyer_note?: string | null
          carton_id?: string | null
          company_code?: string | null
          completed_at?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_code?: string | null
          customs_cny?: number
          destination_code?: string | null
          discount_cny?: number
          display_currency?: string
          domestic_tracking_no?: string | null
          eta?: string | null
          freight_recalc_at?: string | null
          freight_recalc_by?: string | null
          freight_snapshot?: Json | null
          fx_rate?: number
          id?: string
          insurance_cny?: number
          insured?: boolean
          intl_tracking_no?: string | null
          note?: string | null
          order_no?: string
          overridden_by?: string | null
          paid_at?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_method?: string | null
          payment_status?: string
          price_override_reason?: string | null
          route_code?: string | null
          route_id?: string | null
          shipped_at?: string | null
          shipping_cny?: number
          shipping_method?: string
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cny?: number
          total_cny?: number
          tracking_no?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_carton_id_fkey"
            columns: ["carton_id"]
            isOneToOne: false
            referencedRelation: "cartons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "shipping_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      oversize_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_girth_cm: number | null
          max_height_cm: number | null
          max_length_cm: number | null
          max_single_side_cm: number | null
          max_volume_m3: number | null
          max_weight_kg: number | null
          max_width_cm: number | null
          name: string
          notes: string | null
          route_id: string | null
          shipping_method: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_girth_cm?: number | null
          max_height_cm?: number | null
          max_length_cm?: number | null
          max_single_side_cm?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          max_width_cm?: number | null
          name: string
          notes?: string | null
          route_id?: string | null
          shipping_method?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_girth_cm?: number | null
          max_height_cm?: number | null
          max_length_cm?: number | null
          max_single_side_cm?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          max_width_cm?: number | null
          name?: string
          notes?: string | null
          route_id?: string | null
          shipping_method?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oversize_rules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "shipping_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      pallets: {
        Row: {
          address_snapshot: Json | null
          batch_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          customer_code: string | null
          customer_user_id: string | null
          destination_code: string | null
          display_name: string | null
          height_cm: number | null
          id: string
          length_cm: number | null
          notes: string | null
          pallet_no: string | null
          pickup_warehouse: string | null
          route_code: string | null
          route_id: string | null
          self_freight_cad: number
          self_freight_cny: number
          self_height_cm: number | null
          self_length_cm: number | null
          self_volume_m3: number | null
          self_weight_kg: number | null
          self_width_cm: number | null
          sequence_no: number | null
          status: string
          unlocked: boolean
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          address_snapshot?: Json | null
          batch_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_user_id?: string | null
          destination_code?: string | null
          display_name?: string | null
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          notes?: string | null
          pallet_no?: string | null
          pickup_warehouse?: string | null
          route_code?: string | null
          route_id?: string | null
          self_freight_cad?: number
          self_freight_cny?: number
          self_height_cm?: number | null
          self_length_cm?: number | null
          self_volume_m3?: number | null
          self_weight_kg?: number | null
          self_width_cm?: number | null
          sequence_no?: number | null
          status?: string
          unlocked?: boolean
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          address_snapshot?: Json | null
          batch_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          customer_user_id?: string | null
          destination_code?: string | null
          display_name?: string | null
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          notes?: string | null
          pallet_no?: string | null
          pickup_warehouse?: string | null
          route_code?: string | null
          route_id?: string | null
          self_freight_cad?: number
          self_freight_cny?: number
          self_height_cm?: number | null
          self_length_cm?: number | null
          self_volume_m3?: number | null
          self_weight_kg?: number | null
          self_width_cm?: number | null
          sequence_no?: number | null
          status?: string
          unlocked?: boolean
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pallets_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "shipping_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_api_idempotency: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          partner_key: string
          request_fingerprint: string
          response_body: Json | null
          response_status: number | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          partner_key: string
          request_fingerprint: string
          response_body?: Json | null
          response_status?: number | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          partner_key?: string
          request_fingerprint?: string
          response_body?: Json | null
          response_status?: number | null
          status?: string
        }
        Relationships: []
      }
      partner_api_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          name: string | null
          partner_key: string
          revoked_at: string | null
          revoked_by: string | null
          scopes: string[]
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string | null
          partner_key: string
          revoked_at?: string | null
          revoked_by?: string | null
          scopes?: string[]
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string | null
          partner_key?: string
          revoked_at?: string | null
          revoked_by?: string | null
          scopes?: string[]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_api_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_api_tokens_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_customer_mappings: {
        Row: {
          created_at: string
          external_customer_id: string
          id: string
          local_user_id: string
          partner_key: string
        }
        Insert: {
          created_at?: string
          external_customer_id: string
          id?: string
          local_user_id: string
          partner_key: string
        }
        Update: {
          created_at?: string
          external_customer_id?: string
          id?: string
          local_user_id?: string
          partner_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_customer_mappings_local_user_id_fkey"
            columns: ["local_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_orders: {
        Row: {
          box_count_known: boolean
          created_at: string
          domestic_number: string
          forwarding_id: string
          id: string
          local_user_id: string
          partner_key: string
          request_fingerprint: string
          route_code: string
        }
        Insert: {
          box_count_known: boolean
          created_at?: string
          domestic_number: string
          forwarding_id: string
          id?: string
          local_user_id: string
          partner_key: string
          request_fingerprint: string
          route_code: string
        }
        Update: {
          box_count_known?: boolean
          created_at?: string
          domestic_number?: string
          forwarding_id?: string
          id?: string
          local_user_id?: string
          partner_key?: string
          request_fingerprint?: string
          route_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_orders_forwarding_id_fkey"
            columns: ["forwarding_id"]
            isOneToOne: false
            referencedRelation: "forwarding_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_orders_local_user_id_fkey"
            columns: ["local_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          cover_url: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_en: string | null
          parent_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_en?: string | null
          parent_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_en?: string | null
          parent_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          attrs: Json
          barcode: string | null
          created_at: string
          height_cm: number | null
          id: string
          image_url: string | null
          is_active: boolean
          length_cm: number | null
          pack_height_cm: number | null
          pack_length_cm: number | null
          pack_qty: number | null
          pack_volume_m3: number | null
          pack_weight_kg: number | null
          pack_width_cm: number | null
          price_cny: number
          product_id: string
          sku: string
          stock: number
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          attrs?: Json
          barcode?: string | null
          created_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          length_cm?: number | null
          pack_height_cm?: number | null
          pack_length_cm?: number | null
          pack_qty?: number | null
          pack_volume_m3?: number | null
          pack_weight_kg?: number | null
          pack_width_cm?: number | null
          price_cny?: number
          product_id: string
          sku: string
          stock?: number
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          attrs?: Json
          barcode?: string | null
          created_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          length_cm?: number | null
          pack_height_cm?: number | null
          pack_length_cm?: number | null
          pack_qty?: number | null
          pack_volume_m3?: number | null
          pack_weight_kg?: number | null
          pack_width_cm?: number | null
          price_cny?: number
          product_id?: string
          sku?: string
          stock?: number
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          allow_business: boolean
          allow_personal: boolean
          available_route_codes: string[]
          brand: string | null
          business_air_route_code: string | null
          business_sea_route_code: string | null
          cargo_type: string
          category_id: string | null
          compare_price_cad: number | null
          compare_price_cny: number | null
          cover_url: string | null
          created_at: string
          customs_antidumping_rate: number
          customs_gst_rate: number
          customs_mfn_rate: number
          description: string | null
          description_en: string | null
          detail_blocks: Json
          faq_items: Json
          freight_cny: number
          height_cm: number | null
          hs_code: string | null
          id: string
          images: Json
          is_featured: boolean
          lead_time_note: string | null
          lead_time_note_en: string | null
          length_cm: number | null
          manufacturer: string | null
          manufacturer_contact: Json
          moq: number
          name: string
          name_en: string | null
          origin_location: string | null
          origin_location_en: string | null
          origin_port_note: string | null
          origin_port_note_en: string | null
          pack_height_cm: number | null
          pack_length_cm: number | null
          pack_qty: number
          pack_volume_m3: number | null
          pack_weight_kg: number | null
          pack_width_cm: number | null
          packaging_note: string | null
          packaging_note_en: string | null
          personal_air_route_code: string | null
          personal_freight_mode: string
          personal_per_unit_freight_air_cny: number
          personal_per_unit_freight_cny: number
          personal_per_unit_freight_sea_cny: number
          personal_sea_route_code: string | null
          price_cny: number
          purchase_type: Database["public"]["Enums"]["product_purchase_type"]
          sku: string
          slug: string
          sold_count: number
          status: Database["public"]["Enums"]["product_status"]
          subtitle: string | null
          subtitle_en: string | null
          tags: string[]
          total_stock: number
          trust_points: Json
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          allow_business?: boolean
          allow_personal?: boolean
          available_route_codes?: string[]
          brand?: string | null
          business_air_route_code?: string | null
          business_sea_route_code?: string | null
          cargo_type?: string
          category_id?: string | null
          compare_price_cad?: number | null
          compare_price_cny?: number | null
          cover_url?: string | null
          created_at?: string
          customs_antidumping_rate?: number
          customs_gst_rate?: number
          customs_mfn_rate?: number
          description?: string | null
          description_en?: string | null
          detail_blocks?: Json
          faq_items?: Json
          freight_cny?: number
          height_cm?: number | null
          hs_code?: string | null
          id?: string
          images?: Json
          is_featured?: boolean
          lead_time_note?: string | null
          lead_time_note_en?: string | null
          length_cm?: number | null
          manufacturer?: string | null
          manufacturer_contact?: Json
          moq?: number
          name: string
          name_en?: string | null
          origin_location?: string | null
          origin_location_en?: string | null
          origin_port_note?: string | null
          origin_port_note_en?: string | null
          pack_height_cm?: number | null
          pack_length_cm?: number | null
          pack_qty?: number
          pack_volume_m3?: number | null
          pack_weight_kg?: number | null
          pack_width_cm?: number | null
          packaging_note?: string | null
          packaging_note_en?: string | null
          personal_air_route_code?: string | null
          personal_freight_mode?: string
          personal_per_unit_freight_air_cny?: number
          personal_per_unit_freight_cny?: number
          personal_per_unit_freight_sea_cny?: number
          personal_sea_route_code?: string | null
          price_cny?: number
          purchase_type?: Database["public"]["Enums"]["product_purchase_type"]
          sku: string
          slug: string
          sold_count?: number
          status?: Database["public"]["Enums"]["product_status"]
          subtitle?: string | null
          subtitle_en?: string | null
          tags?: string[]
          total_stock?: number
          trust_points?: Json
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          allow_business?: boolean
          allow_personal?: boolean
          available_route_codes?: string[]
          brand?: string | null
          business_air_route_code?: string | null
          business_sea_route_code?: string | null
          cargo_type?: string
          category_id?: string | null
          compare_price_cad?: number | null
          compare_price_cny?: number | null
          cover_url?: string | null
          created_at?: string
          customs_antidumping_rate?: number
          customs_gst_rate?: number
          customs_mfn_rate?: number
          description?: string | null
          description_en?: string | null
          detail_blocks?: Json
          faq_items?: Json
          freight_cny?: number
          height_cm?: number | null
          hs_code?: string | null
          id?: string
          images?: Json
          is_featured?: boolean
          lead_time_note?: string | null
          lead_time_note_en?: string | null
          length_cm?: number | null
          manufacturer?: string | null
          manufacturer_contact?: Json
          moq?: number
          name?: string
          name_en?: string | null
          origin_location?: string | null
          origin_location_en?: string | null
          origin_port_note?: string | null
          origin_port_note_en?: string | null
          pack_height_cm?: number | null
          pack_length_cm?: number | null
          pack_qty?: number
          pack_volume_m3?: number | null
          pack_weight_kg?: number | null
          pack_width_cm?: number | null
          packaging_note?: string | null
          packaging_note_en?: string | null
          personal_air_route_code?: string | null
          personal_freight_mode?: string
          personal_per_unit_freight_air_cny?: number
          personal_per_unit_freight_cny?: number
          personal_per_unit_freight_sea_cny?: number
          personal_sea_route_code?: string | null
          price_cny?: number
          purchase_type?: Database["public"]["Enums"]["product_purchase_type"]
          sku?: string
          slug?: string
          sold_count?: number
          status?: Database["public"]["Enums"]["product_status"]
          subtitle?: string | null
          subtitle_en?: string | null
          tags?: string[]
          total_stock?: number
          trust_points?: Json
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          blacklist_reason: string | null
          created_at: string
          customer_code: string | null
          email: string | null
          fee_scheme_preference: Database["public"]["Enums"]["fee_scheme_preference"]
          full_name: string | null
          id: string
          invoice_address: string | null
          invoice_email: string | null
          invoice_phone: string | null
          invoice_title: string | null
          is_blacklisted: boolean
          phone: string | null
          points: number
          preferred_currency: string
          preferred_lang: string
          reg_address: string | null
          reg_city: string | null
          reg_country: string | null
          reg_phone: string | null
          reg_postal_code: string | null
          reg_province: string | null
          sales_rep_id: string | null
          updated_at: string
          username: string | null
          vip_level: Database["public"]["Enums"]["vip_level"]
          wechat_nickname: string | null
          wechat_openid: string | null
        }
        Insert: {
          avatar_url?: string | null
          blacklist_reason?: string | null
          created_at?: string
          customer_code?: string | null
          email?: string | null
          fee_scheme_preference?: Database["public"]["Enums"]["fee_scheme_preference"]
          full_name?: string | null
          id: string
          invoice_address?: string | null
          invoice_email?: string | null
          invoice_phone?: string | null
          invoice_title?: string | null
          is_blacklisted?: boolean
          phone?: string | null
          points?: number
          preferred_currency?: string
          preferred_lang?: string
          reg_address?: string | null
          reg_city?: string | null
          reg_country?: string | null
          reg_phone?: string | null
          reg_postal_code?: string | null
          reg_province?: string | null
          sales_rep_id?: string | null
          updated_at?: string
          username?: string | null
          vip_level?: Database["public"]["Enums"]["vip_level"]
          wechat_nickname?: string | null
          wechat_openid?: string | null
        }
        Update: {
          avatar_url?: string | null
          blacklist_reason?: string | null
          created_at?: string
          customer_code?: string | null
          email?: string | null
          fee_scheme_preference?: Database["public"]["Enums"]["fee_scheme_preference"]
          full_name?: string | null
          id?: string
          invoice_address?: string | null
          invoice_email?: string | null
          invoice_phone?: string | null
          invoice_title?: string | null
          is_blacklisted?: boolean
          phone?: string | null
          points?: number
          preferred_currency?: string
          preferred_lang?: string
          reg_address?: string | null
          reg_city?: string | null
          reg_country?: string | null
          reg_phone?: string | null
          reg_postal_code?: string | null
          reg_province?: string | null
          sales_rep_id?: string | null
          updated_at?: string
          username?: string | null
          vip_level?: Database["public"]["Enums"]["vip_level"]
          wechat_nickname?: string | null
          wechat_openid?: string | null
        }
        Relationships: []
      }
      promotions: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          rules: Json
          starts_at: string | null
          type: Database["public"]["Enums"]["promo_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          rules?: Json
          starts_at?: string | null
          type?: Database["public"]["Enums"]["promo_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rules?: Json
          starts_at?: string | null
          type?: Database["public"]["Enums"]["promo_type"]
          updated_at?: string
        }
        Relationships: []
      }
      receiving_scans: {
        Row: {
          code: string
          id: string
          kind: string
          note: string | null
          operator_id: string | null
          receiving_id: string
          ref_id: string
          scanned_at: string
        }
        Insert: {
          code: string
          id?: string
          kind: string
          note?: string | null
          operator_id?: string | null
          receiving_id: string
          ref_id: string
          scanned_at?: string
        }
        Update: {
          code?: string
          id?: string
          kind?: string
          note?: string | null
          operator_id?: string | null
          receiving_id?: string
          ref_id?: string
          scanned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receiving_scans_receiving_id_fkey"
            columns: ["receiving_id"]
            isOneToOne: false
            referencedRelation: "receivings"
            referencedColumns: ["id"]
          },
        ]
      }
      receivings: {
        Row: {
          batch_id: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          receiving_no: string
          status: string
          updated_at: string
          warehouse_code: string | null
        }
        Insert: {
          batch_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          receiving_no: string
          status?: string
          updated_at?: string
          warehouse_code?: string | null
        }
        Update: {
          batch_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          receiving_no?: string
          status?: string
          updated_at?: string
          warehouse_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receivings_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier: string | null
          created_at: string
          current_location: string | null
          eta: string | null
          id: string
          order_id: string | null
          shipping_method: string
          status: string
          tracking_no: string
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          current_location?: string | null
          eta?: string | null
          id?: string
          order_id?: string | null
          shipping_method?: string
          status?: string
          tracking_no: string
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          current_location?: string | null
          eta?: string | null
          id?: string
          order_id?: string | null
          shipping_method?: string
          status?: string
          tracking_no?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_routes: {
        Row: {
          allowed_items_text: string | null
          blacklist_customer_codes: string[]
          blacklist_vip_levels: Database["public"]["Enums"]["vip_level"][]
          cargo_type: string
          code: string
          created_at: string
          destination_code: string | null
          destination_warehouse_id: string | null
          id: string
          is_active: boolean
          is_bidirectional: boolean
          item_field_required: Json
          item_fields: string[]
          last_mile_fee_cad: number
          last_mile_formula: string | null
          last_mile_rate_cad: number
          last_mile_step_kg: number
          last_mile_threshold_kg: number
          name_en: string | null
          name_zh: string
          note: string | null
          origin_warehouse_id: string | null
          prohibited_items_text: string | null
          sales_tax_enabled: boolean
          sales_tax_rate_pct: number
          shipping_method: string
          sort_order: number
          transit_days_max: number | null
          transit_days_min: number | null
          updated_at: string
          usage_scope: string
          visible_customer_codes: string[]
          visible_vip_levels: Database["public"]["Enums"]["vip_level"][]
          wechat_ai_enabled: boolean
          wechat_ai_price_text: string | null
        }
        Insert: {
          allowed_items_text?: string | null
          blacklist_customer_codes?: string[]
          blacklist_vip_levels?: Database["public"]["Enums"]["vip_level"][]
          cargo_type?: string
          code: string
          created_at?: string
          destination_code?: string | null
          destination_warehouse_id?: string | null
          id?: string
          is_active?: boolean
          is_bidirectional?: boolean
          item_field_required?: Json
          item_fields?: string[]
          last_mile_fee_cad?: number
          last_mile_formula?: string | null
          last_mile_rate_cad?: number
          last_mile_step_kg?: number
          last_mile_threshold_kg?: number
          name_en?: string | null
          name_zh: string
          note?: string | null
          origin_warehouse_id?: string | null
          prohibited_items_text?: string | null
          sales_tax_enabled?: boolean
          sales_tax_rate_pct?: number
          shipping_method: string
          sort_order?: number
          transit_days_max?: number | null
          transit_days_min?: number | null
          updated_at?: string
          usage_scope?: string
          visible_customer_codes?: string[]
          visible_vip_levels?: Database["public"]["Enums"]["vip_level"][]
          wechat_ai_enabled?: boolean
          wechat_ai_price_text?: string | null
        }
        Update: {
          allowed_items_text?: string | null
          blacklist_customer_codes?: string[]
          blacklist_vip_levels?: Database["public"]["Enums"]["vip_level"][]
          cargo_type?: string
          code?: string
          created_at?: string
          destination_code?: string | null
          destination_warehouse_id?: string | null
          id?: string
          is_active?: boolean
          is_bidirectional?: boolean
          item_field_required?: Json
          item_fields?: string[]
          last_mile_fee_cad?: number
          last_mile_formula?: string | null
          last_mile_rate_cad?: number
          last_mile_step_kg?: number
          last_mile_threshold_kg?: number
          name_en?: string | null
          name_zh?: string
          note?: string | null
          origin_warehouse_id?: string | null
          prohibited_items_text?: string | null
          sales_tax_enabled?: boolean
          sales_tax_rate_pct?: number
          shipping_method?: string
          sort_order?: number
          transit_days_max?: number | null
          transit_days_min?: number | null
          updated_at?: string
          usage_scope?: string
          visible_customer_codes?: string[]
          visible_vip_levels?: Database["public"]["Enums"]["vip_level"][]
          wechat_ai_enabled?: boolean
          wechat_ai_price_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_routes_destination_warehouse_id_fkey"
            columns: ["destination_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_routes_origin_warehouse_id_fkey"
            columns: ["origin_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_cart_items: {
        Row: {
          cart_id: string
          chargeable_kg: number
          created_at: string
          id: string
          line_customs_cny: number
          line_freight_cny: number
          line_insurance_cny: number
          line_subtotal_cny: number
          mode: string
          overridden_at: string | null
          overridden_by: string | null
          override_reason: string | null
          override_unit_price_cny: number | null
          product_id: string | null
          product_slug: string
          quantity: number
          unit_price_cny: number
          units: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          cart_id: string
          chargeable_kg?: number
          created_at?: string
          id?: string
          line_customs_cny?: number
          line_freight_cny?: number
          line_insurance_cny?: number
          line_subtotal_cny?: number
          mode?: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          override_unit_price_cny?: number | null
          product_id?: string | null
          product_slug: string
          quantity?: number
          unit_price_cny?: number
          units?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          cart_id?: string
          chargeable_kg?: number
          created_at?: string
          id?: string
          line_customs_cny?: number
          line_freight_cny?: number
          line_insurance_cny?: number
          line_subtotal_cny?: number
          mode?: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          override_unit_price_cny?: number | null
          product_id?: string | null
          product_slug?: string
          quantity?: number
          unit_price_cny?: number
          units?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "shop_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_carts: {
        Row: {
          address_id: string | null
          address_snapshot: Json | null
          coupon_code: string | null
          created_at: string
          customs_cny: number
          discount_cny: number
          effective_subtotal_cny: number
          effective_total_cny: number
          freight_cny: number
          id: string
          insurance_cny: number
          needs_route: boolean
          note: string | null
          overridden_at: string | null
          overridden_by: string | null
          override_reason: string | null
          override_total_cny: number | null
          quote_snapshot: Json | null
          quoted_at: string | null
          route_code: string | null
          shipping_method: string | null
          status: string
          subtotal_cny: number
          total_cny: number
          updated_at: string
          user_id: string
        }
        Insert: {
          address_id?: string | null
          address_snapshot?: Json | null
          coupon_code?: string | null
          created_at?: string
          customs_cny?: number
          discount_cny?: number
          effective_subtotal_cny?: number
          effective_total_cny?: number
          freight_cny?: number
          id?: string
          insurance_cny?: number
          needs_route?: boolean
          note?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          override_total_cny?: number | null
          quote_snapshot?: Json | null
          quoted_at?: string | null
          route_code?: string | null
          shipping_method?: string | null
          status?: string
          subtotal_cny?: number
          total_cny?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          address_id?: string | null
          address_snapshot?: Json | null
          coupon_code?: string | null
          created_at?: string
          customs_cny?: number
          discount_cny?: number
          effective_subtotal_cny?: number
          effective_total_cny?: number
          freight_cny?: number
          id?: string
          insurance_cny?: number
          needs_route?: boolean
          note?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          override_total_cny?: number | null
          quote_snapshot?: Json | null
          quoted_at?: string | null
          route_code?: string | null
          shipping_method?: string | null
          status?: string
          subtotal_cny?: number
          total_cny?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shop_refunds: {
        Row: {
          amount_cny: number
          created_at: string
          id: string
          operator_id: string | null
          order_id: string
          processed_at: string | null
          reason: string | null
          status: string
        }
        Insert: {
          amount_cny?: number
          created_at?: string
          id?: string
          operator_id?: string | null
          order_id: string
          processed_at?: string | null
          reason?: string | null
          status?: string
        }
        Update: {
          amount_cny?: number
          created_at?: string
          id?: string
          operator_id?: string | null
          order_id?: string
          processed_at?: string | null
          reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      surcharges: {
        Row: {
          amount_cny: number
          batch_id: string | null
          carton_id: string | null
          created_at: string
          created_by: string | null
          customer_code: string | null
          forwarding_id: string | null
          id: string
          note: string
          pallet_id: string | null
          scope: Database["public"]["Enums"]["surcharge_scope"]
          updated_at: string
          waybill_id: string | null
        }
        Insert: {
          amount_cny?: number
          batch_id?: string | null
          carton_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          forwarding_id?: string | null
          id?: string
          note?: string
          pallet_id?: string | null
          scope: Database["public"]["Enums"]["surcharge_scope"]
          updated_at?: string
          waybill_id?: string | null
        }
        Update: {
          amount_cny?: number
          batch_id?: string | null
          carton_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string | null
          forwarding_id?: string | null
          id?: string
          note?: string
          pallet_id?: string | null
          scope?: Database["public"]["Enums"]["surcharge_scope"]
          updated_at?: string
          waybill_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "surcharges_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surcharges_carton_id_fkey"
            columns: ["carton_id"]
            isOneToOne: false
            referencedRelation: "cartons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surcharges_forwarding_id_fkey"
            columns: ["forwarding_id"]
            isOneToOne: false
            referencedRelation: "forwarding_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surcharges_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surcharges_waybill_id_fkey"
            columns: ["waybill_id"]
            isOneToOne: false
            referencedRelation: "waybills"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_event_presets: {
        Row: {
          code: string
          created_at: string
          default_location_en: string | null
          default_location_zh: string | null
          id: string
          is_active: boolean
          label_en: string | null
          label_zh: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_location_en?: string | null
          default_location_zh?: string | null
          id?: string
          is_active?: boolean
          label_en?: string | null
          label_zh: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_location_en?: string | null
          default_location_zh?: string | null
          id?: string
          is_active?: boolean
          label_en?: string | null
          label_zh?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      tracking_events: {
        Row: {
          created_at: string
          event_time: string
          id: string
          location_en: string | null
          location_zh: string | null
          shipment_id: string
          source: string
          source_ref: string | null
          status_en: string
          status_zh: string
        }
        Insert: {
          created_at?: string
          event_time?: string
          id?: string
          location_en?: string | null
          location_zh?: string | null
          shipment_id: string
          source?: string
          source_ref?: string | null
          status_en: string
          status_zh: string
        }
        Update: {
          created_at?: string
          event_time?: string
          id?: string
          location_en?: string | null
          location_zh?: string | null
          shipment_id?: string
          source?: string
          source_ref?: string | null
          status_en?: string
          status_zh?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
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
      variant_stocks: {
        Row: {
          created_at: string
          id: string
          stock: number
          updated_at: string
          variant_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          stock?: number
          updated_at?: string
          variant_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          id?: string
          stock?: number
          updated_at?: string
          variant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_stocks_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stocks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount_cad: number
          amount_cny: number | null
          channel: string | null
          created_at: string
          fx_rate_cny_to_cad: number | null
          id: string
          idempotency_key: string | null
          note: string | null
          pay_session: Json | null
          provider_payment_id: string | null
          provider_response: Json | null
          provider_status: string | null
          receipt_at: string | null
          receipt_by: string | null
          receipt_reason: string | null
          ref_no: string | null
          related_order_id: string | null
          status: string
          type: string
          user_id: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount_cad: number
          amount_cny?: number | null
          channel?: string | null
          created_at?: string
          fx_rate_cny_to_cad?: number | null
          id?: string
          idempotency_key?: string | null
          note?: string | null
          pay_session?: Json | null
          provider_payment_id?: string | null
          provider_response?: Json | null
          provider_status?: string | null
          receipt_at?: string | null
          receipt_by?: string | null
          receipt_reason?: string | null
          ref_no?: string | null
          related_order_id?: string | null
          status?: string
          type: string
          user_id: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount_cad?: number
          amount_cny?: number | null
          channel?: string | null
          created_at?: string
          fx_rate_cny_to_cad?: number | null
          id?: string
          idempotency_key?: string | null
          note?: string | null
          pay_session?: Json | null
          provider_payment_id?: string | null
          provider_response?: Json | null
          provider_status?: string | null
          receipt_at?: string | null
          receipt_by?: string | null
          receipt_reason?: string | null
          ref_no?: string | null
          related_order_id?: string | null
          status?: string
          type?: string
          user_id?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance_cad: number
          balance_cny: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_cad?: number
          balance_cny?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_cad?: number
          balance_cny?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          address: string | null
          business_hours: string | null
          can_destination: boolean
          can_inventory: boolean
          can_origin: boolean
          code: string
          contact: string | null
          country: string
          created_at: string
          id: string
          inout_fee_cad_per_cbm: number
          is_active: boolean
          name_en: string | null
          name_zh: string
          note: string | null
          phone: string | null
          sort_order: number
          storage_fee_cad_per_cbm_day: number
          storage_free_days: number
          type: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_hours?: string | null
          can_destination?: boolean
          can_inventory?: boolean
          can_origin?: boolean
          code: string
          contact?: string | null
          country: string
          created_at?: string
          id?: string
          inout_fee_cad_per_cbm?: number
          is_active?: boolean
          name_en?: string | null
          name_zh: string
          note?: string | null
          phone?: string | null
          sort_order?: number
          storage_fee_cad_per_cbm_day?: number
          storage_free_days?: number
          type?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_hours?: string | null
          can_destination?: boolean
          can_inventory?: boolean
          can_origin?: boolean
          code?: string
          contact?: string | null
          country?: string
          created_at?: string
          id?: string
          inout_fee_cad_per_cbm?: number
          is_active?: boolean
          name_en?: string | null
          name_zh?: string
          note?: string | null
          phone?: string | null
          sort_order?: number
          storage_fee_cad_per_cbm_day?: number
          storage_free_days?: number
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      waybill_items: {
        Row: {
          anti_dumping_rate: number | null
          created_at: string
          declared_value_cad: number | null
          duty_applied: boolean
          duty_cad: number | null
          forwarding_item_id: string | null
          gst_rate: number | null
          hs_code: string | null
          hs_confirmed: boolean
          hs_matched: string | null
          id: string
          mfn_rate: number | null
          name: string
          order_item_id: string | null
          quantity: number
          tax_rate: number | null
          unit_price_cad: number | null
          updated_at: string
          waybill_id: string
        }
        Insert: {
          anti_dumping_rate?: number | null
          created_at?: string
          declared_value_cad?: number | null
          duty_applied?: boolean
          duty_cad?: number | null
          forwarding_item_id?: string | null
          gst_rate?: number | null
          hs_code?: string | null
          hs_confirmed?: boolean
          hs_matched?: string | null
          id?: string
          mfn_rate?: number | null
          name?: string
          order_item_id?: string | null
          quantity?: number
          tax_rate?: number | null
          unit_price_cad?: number | null
          updated_at?: string
          waybill_id: string
        }
        Update: {
          anti_dumping_rate?: number | null
          created_at?: string
          declared_value_cad?: number | null
          duty_applied?: boolean
          duty_cad?: number | null
          forwarding_item_id?: string | null
          gst_rate?: number | null
          hs_code?: string | null
          hs_confirmed?: boolean
          hs_matched?: string | null
          id?: string
          mfn_rate?: number | null
          name?: string
          order_item_id?: string | null
          quantity?: number
          tax_rate?: number | null
          unit_price_cad?: number | null
          updated_at?: string
          waybill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waybill_items_forwarding_item_id_fkey"
            columns: ["forwarding_item_id"]
            isOneToOne: false
            referencedRelation: "forwarding_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waybill_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waybill_items_waybill_id_fkey"
            columns: ["waybill_id"]
            isOneToOne: false
            referencedRelation: "waybills"
            referencedColumns: ["id"]
          },
        ]
      }
      waybill_no_counters: {
        Row: {
          scope_key: string
          seq: number
          updated_at: string
        }
        Insert: {
          scope_key: string
          seq?: number
          updated_at?: string
        }
        Update: {
          scope_key?: string
          seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      waybills: {
        Row: {
          aliases: string[]
          assigned_batch_id: string | null
          batch_no: string | null
          box_no: string | null
          carton_id: string | null
          clearance_cad: number
          client_package_id: string | null
          created_at: string
          duty_cad: number
          eta: string | null
          forwarding_id: string | null
          freight_cad: number
          height_cm: number | null
          id: string
          insurance_cad: number
          intl_tracking_no: string | null
          items_summary: Json
          length_cm: number | null
          mark_no: string | null
          note: string | null
          order_id: string | null
          pallet_id: string | null
          pallet_no: string | null
          payment_status: string
          shipping_method: string | null
          status: Database["public"]["Enums"]["waybill_status"]
          surcharge_cad: number
          updated_at: string
          user_id: string
          waybill_no: string
          weight_kg: number | null
          weight_snapshot: Json | null
          width_cm: number | null
        }
        Insert: {
          aliases?: string[]
          assigned_batch_id?: string | null
          batch_no?: string | null
          box_no?: string | null
          carton_id?: string | null
          clearance_cad?: number
          client_package_id?: string | null
          created_at?: string
          duty_cad?: number
          eta?: string | null
          forwarding_id?: string | null
          freight_cad?: number
          height_cm?: number | null
          id?: string
          insurance_cad?: number
          intl_tracking_no?: string | null
          items_summary?: Json
          length_cm?: number | null
          mark_no?: string | null
          note?: string | null
          order_id?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_status?: string
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["waybill_status"]
          surcharge_cad?: number
          updated_at?: string
          user_id: string
          waybill_no: string
          weight_kg?: number | null
          weight_snapshot?: Json | null
          width_cm?: number | null
        }
        Update: {
          aliases?: string[]
          assigned_batch_id?: string | null
          batch_no?: string | null
          box_no?: string | null
          carton_id?: string | null
          clearance_cad?: number
          client_package_id?: string | null
          created_at?: string
          duty_cad?: number
          eta?: string | null
          forwarding_id?: string | null
          freight_cad?: number
          height_cm?: number | null
          id?: string
          insurance_cad?: number
          intl_tracking_no?: string | null
          items_summary?: Json
          length_cm?: number | null
          mark_no?: string | null
          note?: string | null
          order_id?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_status?: string
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["waybill_status"]
          surcharge_cad?: number
          updated_at?: string
          user_id?: string
          waybill_no?: string
          weight_kg?: number | null
          weight_snapshot?: Json | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "waybills_assigned_batch_id_fkey"
            columns: ["assigned_batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waybills_carton_id_fkey"
            columns: ["carton_id"]
            isOneToOne: false
            referencedRelation: "cartons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waybills_forwarding_id_fkey"
            columns: ["forwarding_id"]
            isOneToOne: false
            referencedRelation: "forwarding_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waybills_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waybills_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wechat_ai_admin_audit: {
        Row: {
          action: string
          admin_user_id: string | null
          after_data: Json
          before_data: Json
          created_at: string
          id: string
          reason: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          admin_user_id?: string | null
          after_data?: Json
          before_data?: Json
          created_at?: string
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          after_data?: Json
          before_data?: Json
          created_at?: string
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      wechat_ai_agent_runs: {
        Row: {
          conversation_id: string
          created_at: string
          error_code: string | null
          id: string
          input_context_summary: string | null
          intent: string | null
          model: string | null
          openai_duration_ms: number | null
          openai_status: number | null
          result_status: string | null
          state_after: Json
          state_before: Json
          state_patch: Json
          tool_requested: string | null
          total_duration_ms: number | null
          user_message_id: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          input_context_summary?: string | null
          intent?: string | null
          model?: string | null
          openai_duration_ms?: number | null
          openai_status?: number | null
          result_status?: string | null
          state_after?: Json
          state_before?: Json
          state_patch?: Json
          tool_requested?: string | null
          total_duration_ms?: number | null
          user_message_id?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          input_context_summary?: string | null
          intent?: string | null
          model?: string | null
          openai_duration_ms?: number | null
          openai_status?: number | null
          result_status?: string | null
          state_after?: Json
          state_before?: Json
          state_patch?: Json
          tool_requested?: string | null
          total_duration_ms?: number | null
          user_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wechat_ai_agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wechat_ai_agent_runs_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wechat_ai_bind_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          used_at: string | null
          used_by_visitor_biz_id: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          used_at?: string | null
          used_by_visitor_biz_id?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
          used_by_visitor_biz_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wechat_ai_conversations: {
        Row: {
          awaiting_field: string | null
          corp_id_hash: string | null
          created_at: string
          current_intent: string | null
          customer_code: string | null
          external_userid: string
          id: string
          last_message_at: string
          last_tracking_number: string | null
          open_kfid: string
          pending_action: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          awaiting_field?: string | null
          corp_id_hash?: string | null
          created_at?: string
          current_intent?: string | null
          customer_code?: string | null
          external_userid: string
          id?: string
          last_message_at?: string
          last_tracking_number?: string | null
          open_kfid: string
          pending_action?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          awaiting_field?: string | null
          corp_id_hash?: string | null
          created_at?: string
          current_intent?: string | null
          customer_code?: string | null
          external_userid?: string
          id?: string
          last_message_at?: string
          last_tracking_number?: string | null
          open_kfid?: string
          pending_action?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      wechat_ai_messages: {
        Row: {
          conversation_id: string
          created_at: string
          direction: string
          id: string
          media_id: string | null
          message_type: string
          msgid: string | null
          ocr_confidence: number | null
          ocr_text: string | null
          origin: number | null
          processing_status: string | null
          received_at: string
          reply_to_message_id: string | null
          send_time: string | null
          text_content: string | null
          wechat_errcode: number | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          media_id?: string | null
          message_type?: string
          msgid?: string | null
          ocr_confidence?: number | null
          ocr_text?: string | null
          origin?: number | null
          processing_status?: string | null
          received_at?: string
          reply_to_message_id?: string | null
          send_time?: string | null
          text_content?: string | null
          wechat_errcode?: number | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          media_id?: string | null
          message_type?: string
          msgid?: string | null
          ocr_confidence?: number | null
          ocr_text?: string | null
          origin?: number | null
          processing_status?: string | null
          received_at?: string
          reply_to_message_id?: string | null
          send_time?: string | null
          text_content?: string | null
          wechat_errcode?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wechat_ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wechat_ai_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wechat_ai_tool_runs: {
        Row: {
          agent_run_id: string | null
          conversation_id: string | null
          created_at: string
          duration_ms: number | null
          id: string
          request_summary: Json
          response_summary: Json
          result_code: string | null
          success: boolean
          tool_name: string
        }
        Insert: {
          agent_run_id?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          request_summary?: Json
          response_summary?: Json
          result_code?: string | null
          success?: boolean
          tool_name: string
        }
        Update: {
          agent_run_id?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          request_summary?: Json
          response_summary?: Json
          result_code?: string | null
          success?: boolean
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "wechat_ai_tool_runs_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wechat_ai_tool_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wechat_bind_states: {
        Row: {
          created_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      wechat_callback_dedup: {
        Row: {
          created_at: string
          expires_at: string
          hash: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          hash?: string
        }
        Relationships: []
      }
      wechat_forwarding_draft_events: {
        Row: {
          after_data: Json
          before_data: Json
          changed_fields: Json
          created_at: string
          draft_id: string
          id: string
          message_id: string | null
        }
        Insert: {
          after_data?: Json
          before_data?: Json
          changed_fields?: Json
          created_at?: string
          draft_id: string
          id?: string
          message_id?: string | null
        }
        Update: {
          after_data?: Json
          before_data?: Json
          changed_fields?: Json
          created_at?: string
          draft_id?: string
          id?: string
          message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wechat_forwarding_draft_events_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "wechat_forwarding_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wechat_forwarding_draft_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wechat_forwarding_drafts: {
        Row: {
          completed_at: string | null
          conversation_id: string
          created_at: string
          created_fw_tracking_no: string | null
          customer_code: string | null
          draft_data: Json
          draft_status: string
          expires_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          conversation_id: string
          created_at?: string
          created_fw_tracking_no?: string | null
          customer_code?: string | null
          draft_data?: Json
          draft_status?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          conversation_id?: string
          created_at?: string
          created_fw_tracking_no?: string | null
          customer_code?: string | null
          draft_data?: Json
          draft_status?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wechat_forwarding_drafts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wechat_ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wechat_gpt_session: {
        Row: {
          create_order_draft: Json
          created_at: string
          current_intent: string | null
          expires_at: string
          external_userid: string
          last_seen_at: string
          last_tracking_number: string | null
          open_kfid: string
          pending_action: string | null
          updated_at: string
          welcome_sent: boolean
        }
        Insert: {
          create_order_draft?: Json
          created_at?: string
          current_intent?: string | null
          expires_at?: string
          external_userid: string
          last_seen_at?: string
          last_tracking_number?: string | null
          open_kfid: string
          pending_action?: string | null
          updated_at?: string
          welcome_sent?: boolean
        }
        Update: {
          create_order_draft?: Json
          created_at?: string
          current_intent?: string | null
          expires_at?: string
          external_userid?: string
          last_seen_at?: string
          last_tracking_number?: string | null
          open_kfid?: string
          pending_action?: string | null
          updated_at?: string
          welcome_sent?: boolean
        }
        Relationships: []
      }
      wechat_identity_bindings: {
        Row: {
          binding_source: string
          bound_at: string
          channel_type: string
          chat_id: string | null
          corp_id_hash: string | null
          created_at: string
          customer_code: string
          customer_display_name: string | null
          display_group_name: string | null
          external_userid: string | null
          id: string
          last_used_at: string | null
          open_kfid: string | null
          status: string
          unbound_at: string | null
          updated_at: string
          user_id: string
          verified: boolean
          visitor_biz_id: string | null
        }
        Insert: {
          binding_source?: string
          bound_at?: string
          channel_type: string
          chat_id?: string | null
          corp_id_hash?: string | null
          created_at?: string
          customer_code: string
          customer_display_name?: string | null
          display_group_name?: string | null
          external_userid?: string | null
          id?: string
          last_used_at?: string | null
          open_kfid?: string | null
          status?: string
          unbound_at?: string | null
          updated_at?: string
          user_id: string
          verified?: boolean
          visitor_biz_id?: string | null
        }
        Update: {
          binding_source?: string
          bound_at?: string
          channel_type?: string
          chat_id?: string | null
          corp_id_hash?: string | null
          created_at?: string
          customer_code?: string
          customer_display_name?: string | null
          display_group_name?: string | null
          external_userid?: string | null
          id?: string
          last_used_at?: string | null
          open_kfid?: string | null
          status?: string
          unbound_at?: string | null
          updated_at?: string
          user_id?: string
          verified?: boolean
          visitor_biz_id?: string | null
        }
        Relationships: []
      }
      wechat_kf_cursor: {
        Row: {
          cursor: string | null
          open_kfid: string
          updated_at: string
        }
        Insert: {
          cursor?: string | null
          open_kfid: string
          updated_at?: string
        }
        Update: {
          cursor?: string | null
          open_kfid?: string
          updated_at?: string
        }
        Relationships: []
      }
      wechat_kf_image_cache: {
        Row: {
          created_at: string
          expires_at: string
          result: Json
          sha256: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          result: Json
          sha256: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          result?: Json
          sha256?: string
        }
        Relationships: []
      }
      wechat_kf_lock: {
        Row: {
          locked_until: string
          open_kfid: string
          updated_at: string
        }
        Insert: {
          locked_until?: string
          open_kfid: string
          updated_at?: string
        }
        Update: {
          locked_until?: string
          open_kfid?: string
          updated_at?: string
        }
        Relationships: []
      }
      wechat_kf_msg_dedup: {
        Row: {
          created_at: string
          msgid: string
        }
        Insert: {
          created_at?: string
          msgid: string
        }
        Update: {
          created_at?: string
          msgid?: string
        }
        Relationships: []
      }
      wechat_kf_state: {
        Row: {
          created_at: string
          draft: Json
          expires_at: string
          external_userid: string
          open_kfid: string | null
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft?: Json
          expires_at?: string
          external_userid: string
          open_kfid?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft?: Json
          expires_at?: string
          external_userid?: string
          open_kfid?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      wechat_kf_token: {
        Row: {
          access_token: string
          expires_at: string
          id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      wechat_login_states: {
        Row: {
          created_at: string
          state: string
        }
        Insert: {
          created_at?: string
          state: string
        }
        Update: {
          created_at?: string
          state?: string
        }
        Relationships: []
      }
      wecom_notify_bindings: {
        Row: {
          bound_at: string
          bound_by: string | null
          chat_id: string
          customer_code: string
          id: string
        }
        Insert: {
          bound_at?: string
          bound_by?: string | null
          chat_id: string
          customer_code: string
          id?: string
        }
        Update: {
          bound_at?: string
          bound_by?: string | null
          chat_id?: string
          customer_code?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wecom_notify_bindings_bound_by_fkey"
            columns: ["bound_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wecom_notify_bindings_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: true
            referencedRelation: "wecom_notify_groups"
            referencedColumns: ["chat_id"]
          },
        ]
      }
      wecom_notify_groups: {
        Row: {
          chat_id: string
          created_at: string
          member_count: number
          name: string
          owner_userid: string | null
          synced_at: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          member_count?: number
          name?: string
          owner_userid?: string | null
          synced_at?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          member_count?: number
          name?: string
          owner_userid?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      wecom_notify_message_targets: {
        Row: {
          chat_id: string
          created_at: string
          customer_code: string
          error: string | null
          id: string
          message_id: string
          rendered_content: string
          sent_at: string | null
          status: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          customer_code: string
          error?: string | null
          id?: string
          message_id: string
          rendered_content: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          customer_code?: string
          error?: string | null
          id?: string
          message_id?: string
          rendered_content?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wecom_notify_message_targets_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "wecom_notify_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wecom_notify_messages: {
        Row: {
          content_template: string
          created_at: string
          created_by: string | null
          id: string
          send_result: Json | null
          sent_at: string | null
          status: string
          target_customer_codes: string[]
          target_scope: string
          title: string
        }
        Insert: {
          content_template: string
          created_at?: string
          created_by?: string | null
          id?: string
          send_result?: Json | null
          sent_at?: string | null
          status?: string
          target_customer_codes?: string[]
          target_scope?: string
          title?: string
        }
        Update: {
          content_template?: string
          created_at?: string
          created_by?: string | null
          id?: string
          send_result?: Json | null
          sent_at?: string | null
          status?: string
          target_customer_codes?: string[]
          target_scope?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "wecom_notify_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wecom_notify_token: {
        Row: {
          access_token: string
          expires_at: string
          id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          id?: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _compute_line_quote:
        | {
            Args: {
              _customs: Database["public"]["Tables"]["customs_rules"]["Row"]
              _product: Database["public"]["Tables"]["products"]["Row"]
              _qty: number
              _route: Database["public"]["Tables"]["shipping_routes"]["Row"]
              _rule: Database["public"]["Tables"]["freight_rules"]["Row"]
            }
            Returns: Json
          }
        | {
            Args: {
              _customs: Database["public"]["Tables"]["customs_rules"]["Row"]
              _mode?: string
              _product: Database["public"]["Tables"]["products"]["Row"]
              _qty: number
              _route: Database["public"]["Tables"]["shipping_routes"]["Row"]
              _rule: Database["public"]["Tables"]["freight_rules"]["Row"]
            }
            Returns: Json
          }
        | {
            Args: {
              _customs: Database["public"]["Tables"]["customs_rules"]["Row"]
              _mode?: string
              _product: Database["public"]["Tables"]["products"]["Row"]
              _qty: number
              _route: Database["public"]["Tables"]["shipping_routes"]["Row"]
              _rule: Database["public"]["Tables"]["freight_rules"]["Row"]
              _variant?: Database["public"]["Tables"]["product_variants"]["Row"]
            }
            Returns: Json
          }
      _ott_reconcile_tick: { Args: never; Returns: undefined }
      _product_route_code: {
        Args: {
          _method: string
          _mode: string
          _p: Database["public"]["Tables"]["products"]["Row"]
        }
        Returns: string
      }
      _shop_cart_ensure_active: { Args: never; Returns: string }
      _shop_cart_payload: { Args: { _cart_id: string }; Returns: Json }
      _shop_cart_reprice: { Args: { _cart_id: string }; Returns: undefined }
      _wallet_recharge_settle_system: {
        Args: { _payload: Json }
        Returns: Json
      }
      admin_change_route: {
        Args: {
          _entity_id: string
          _entity_type: string
          _new_route_code: string
          _note?: string
          _operator_id?: string
        }
        Returns: Json
      }
      admin_list_users: {
        Args: {
          _limit?: number
          _offset?: number
          _role?: Database["public"]["Enums"]["app_role"]
          _search?: string
          _unpaid_only?: boolean
          _vip?: Database["public"]["Enums"]["vip_level"]
        }
        Returns: Json
      }
      admin_ship_shop_order: { Args: { _order_id: string }; Returns: Json }
      ai_proxy_set_secret: {
        Args: { _key: string; _value: string }
        Returns: boolean
      }
      award_points_for_spend: {
        Args: { _amount_cad: number; _user_id: string }
        Returns: number
      }
      batch_payment_status: { Args: { _batch_id: string }; Returns: string }
      cancel_ai_forwarding_draft: { Args: { _draft_id: string }; Returns: Json }
      carton_payment_status: { Args: { _carton_id: string }; Returns: string }
      chatgpt_admin_get_audit_log: { Args: { _log_id: string }; Returns: Json }
      chatgpt_admin_get_batch: { Args: { _batch_no: string }; Returns: Json }
      chatgpt_admin_get_customer: {
        Args: { _customer_code: string }
        Returns: Json
      }
      chatgpt_admin_get_invoice: {
        Args: { _invoice_no: string }
        Returns: Json
      }
      chatgpt_admin_get_order: { Args: { _order_no: string }; Returns: Json }
      chatgpt_admin_get_waybill: {
        Args: { _waybill_no: string }
        Returns: Json
      }
      chatgpt_admin_search_audit_logs: {
        Args: {
          _action?: string
          _date_from?: string
          _date_to?: string
          _entity_type?: string
          _limit?: number
          _query?: string
        }
        Returns: Json
      }
      chatgpt_admin_search_batches: {
        Args: { _limit?: number; _query?: string; _status?: string }
        Returns: Json
      }
      chatgpt_admin_search_forwardings: {
        Args: { _limit?: number; _query?: string; _status?: string }
        Returns: Json
      }
      chatgpt_admin_search_invoices: {
        Args: { _limit?: number; _query?: string; _status?: string }
        Returns: Json
      }
      chatgpt_admin_search_orders: {
        Args: { _limit?: number; _query?: string }
        Returns: Json
      }
      chatgpt_admin_search_waybills: {
        Args: { _limit?: number; _query?: string; _status?: string }
        Returns: Json
      }
      chatgpt_correct_my_pending_tracking: {
        Args: {
          _confirmation: string
          _expected_tracking_no: string
          _new_tracking_no: string
          _order_type: string
          _reason: string
          _record_id: string
        }
        Returns: Json
      }
      chatgpt_diagnose_my_pending_intake: {
        Args: { _tracking_no: string }
        Returns: Json
      }
      chatgpt_list_my_support_messages: {
        Args: { _limit?: number }
        Returns: {
          body: string
          created_at: string
          customer_user_id: string
          id: string
          read_by_customer_at: string | null
          read_by_staff_at: string | null
          sender_role: string
          sender_user_id: string | null
          source: string
          thread_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_support_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chatgpt_manager_set_waybill_status: {
        Args: {
          _confirmation: string
          _expected_updated_at: string
          _public_event?: Json
          _reason: string
          _status: Database["public"]["Enums"]["waybill_status"]
          _waybill_no: string
        }
        Returns: Json
      }
      chatgpt_owner_access: { Args: never; Returns: Json }
      chatgpt_owner_dashboard: { Args: never; Returns: Json }
      chatgpt_owner_get_forwarding: {
        Args: { _request_no: string }
        Returns: Json
      }
      chatgpt_owner_pending_forwardings: {
        Args: { _limit?: number }
        Returns: Json
      }
      chatgpt_owner_search_customers: {
        Args: { _limit?: number; _query?: string }
        Returns: Json
      }
      chatgpt_owner_update_forwarding_basic_info: {
        Args: {
          _confirmation: string
          _expected_updated_at: string
          _patch: Json
          _reason: string
          _request_no: string
        }
        Returns: Json
      }
      chatgpt_send_my_support_message: {
        Args: { _body: string }
        Returns: Json
      }
      chatgpt_staff_send_support_message: {
        Args: { _body: string; _customer_code: string }
        Returns: Json
      }
      check_email_available: { Args: { p_email: string }; Returns: boolean }
      check_phone_available: { Args: { p_phone: string }; Returns: boolean }
      check_username_available: {
        Args: { p_username: string }
        Returns: boolean
      }
      confirm_ai_forwarding_draft:
        | { Args: { _draft_id: string }; Returns: Json }
        | {
            Args: { _draft_id: string; _expected_version: number }
            Returns: Json
          }
      current_fx_cny_to_cad: { Args: never; Returns: number }
      find_by_any_no: { Args: { _input: string }; Returns: Json }
      gen_customer_code: { Args: never; Returns: string }
      gen_short_no: {
        Args: {
          _at: string
          _customer_code: string
          _prefix: string
          _route_code: string
        }
        Returns: string
      }
      gen_waybill_no: {
        Args: {
          _customer_code?: string
          _destination_code?: string
          _route_code?: string
          _shipping_method?: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      infer_material: { Args: { _hs: string; _name: string }; Returns: string }
      is_forwarding_route_visible_to_user: {
        Args: { _route_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      lookup_shipment: { Args: { _tracking_no: string }; Returns: Json }
      mark_invoices_overdue: { Args: never; Returns: number }
      normalize_no: { Args: { _input: string }; Returns: string }
      normalize_phone: { Args: { p_phone: string }; Returns: string }
      openai_responses_proxy: {
        Args: { _payload: Json; _token: string }
        Returns: Json
      }
      pallet_payment_status: { Args: { _pallet_id: string }; Returns: string }
      pay_batch: { Args: { _batch_no: string }; Returns: Json }
      pay_invoice: { Args: { _invoice_id: string }; Returns: Json }
      pay_order_items: { Args: { _item_ids: string[] }; Returns: Json }
      pay_storage_fees: { Args: { _target_user_id?: string }; Returns: Json }
      place_forwarding: {
        Args: { _payload: Json; _target_user_id?: string }
        Returns: Json
      }
      place_shop_order: { Args: { _payload: Json }; Returns: Json }
      preview_storage_fees: {
        Args: { _target_user_id?: string }
        Returns: Json
      }
      quote_forwarding_cad: {
        Args: {
          _declared_cad?: number
          _direction?: string
          _route_code: string
          _volume_cm3?: number
          _weight_kg: number
        }
        Returns: Json
      }
      quote_shop_order: { Args: { _payload: Json }; Returns: Json }
      recompute_mark_nos_for_parent: {
        Args: { _forwarding_id: string; _order_id: string }
        Returns: undefined
      }
      recompute_parent_status: {
        Args: { _forwarding_id: string; _order_id: string }
        Returns: undefined
      }
      recompute_waybill_items_summary: {
        Args: { _waybill_id: string }
        Returns: undefined
      }
      resolve_hs_code_rates: {
        Args: {
          p_gst_rate: number
          p_hs_code: string
          p_mfn_rate: number
          p_name_zh: string
          p_sima_involved: boolean
          p_unit: string
        }
        Returns: Json
      }
      resolve_login_email: { Args: { p_identifier: string }; Returns: string }
      settle_batch_customer_txn: { Args: { _payload: Json }; Returns: Json }
      ship_create_forwarding_order: {
        Args: {
          _address_id: string
          _box_known: boolean
          _domestic_number: string
          _insured: boolean
          _items: Json
          _local_user_id: string
          _note: string
          _packages: Json
          _partner_key: string
          _request_fingerprint: string
          _route_code: string
          _warehouse_code: string
        }
        Returns: Json
      }
      ship_delete_forwarding_order: {
        Args: { _domestic_number: string; _partner_key: string }
        Returns: Json
      }
      ship_update_forwarding_order: {
        Args: {
          _box_known: boolean
          _destination: string
          _domestic_number: string
          _items: Json
          _note: string
          _packages: Json
          _partner_key: string
          _recipient: Json
          _warehouse_code: string
        }
        Returns: Json
      }
      shop_cart_admin_adjust: { Args: { _payload: Json }; Returns: Json }
      shop_cart_get: { Args: never; Returns: Json }
      shop_cart_reprice: { Args: never; Returns: Json }
      shop_cart_sync: { Args: { _payload: Json }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      track_by_any_no: { Args: { _input: string }; Returns: Json }
      unpaid_batches_summary: {
        Args: never
        Returns: {
          batch_no: string
          shipping_method: string
          total_cny: number
        }[]
      }
      validate_coupon: {
        Args: { _code: string; _subtotal_cny: number }
        Returns: Json
      }
      wallet_recharge_action: { Args: { _payload: Json }; Returns: Json }
      wallet_tx_admin_receipt: { Args: { _payload: Json }; Returns: Json }
      waybill_status_rank: {
        Args: { _s: Database["public"]["Enums"]["waybill_status"] }
        Returns: number
      }
      wechat_callback_claim: { Args: { _hash: string }; Returns: boolean }
      wechat_expire_stale_drafts: { Args: never; Returns: number }
      wechat_gpt_claim_welcome: {
        Args: { _external_userid: string; _open_kfid: string }
        Returns: boolean
      }
      wechat_gpt_cleanup: { Args: never; Returns: undefined }
      wechat_kf_image_cache_get: { Args: { _sha256: string }; Returns: Json }
      wechat_kf_msg_claim: { Args: { _msgid: string }; Returns: boolean }
      wechat_kf_release_lock: {
        Args: { _open_kfid: string }
        Returns: undefined
      }
      wechat_kf_try_lock: {
        Args: { _open_kfid: string; _ttl_seconds?: number }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "owner"
        | "manager"
        | "warehouse_cn"
        | "warehouse_ca"
        | "driver"
        | "pickup_point"
        | "sales"
        | "support"
        | "customer"
        | "sales_rep"
      batch_method: "air" | "sea" | "express"
      batch_status: "draft" | "locked" | "shipped" | "arrived" | "closed"
      cms_status: "draft" | "published" | "archived"
      coupon_type: "fixed" | "percent"
      fee_scheme_preference: "merged" | "split"
      inv_reason: "in" | "out" | "adjust" | "sale" | "return"
      invoice_status: "unpaid" | "paid" | "overdue" | "void"
      invoice_type: "waybill" | "batch" | "monthly" | "manual" | "shop"
      order_status:
        | "pending"
        | "paid"
        | "procurement"
        | "received"
        | "packed"
        | "in_transit"
        | "ready_pickup"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "storage"
        | "arrived"
      product_purchase_type: "personal" | "business"
      product_status: "draft" | "active" | "archived"
      promo_type: "discount" | "bundle" | "flash"
      surcharge_scope: "waybill" | "carton" | "pallet" | "batch" | "forwarding"
      vip_level: "normal" | "silver" | "gold" | "diamond" | "ship" | "owner"
      waybill_status:
        | "pending"
        | "received"
        | "packed"
        | "shipped"
        | "in_transit"
        | "ready_pickup"
        | "delivered"
        | "cancelled"
        | "procurement"
        | "storage"
        | "arrived"
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
      app_role: [
        "owner",
        "manager",
        "warehouse_cn",
        "warehouse_ca",
        "driver",
        "pickup_point",
        "sales",
        "support",
        "customer",
        "sales_rep",
      ],
      batch_method: ["air", "sea", "express"],
      batch_status: ["draft", "locked", "shipped", "arrived", "closed"],
      cms_status: ["draft", "published", "archived"],
      coupon_type: ["fixed", "percent"],
      fee_scheme_preference: ["merged", "split"],
      inv_reason: ["in", "out", "adjust", "sale", "return"],
      invoice_status: ["unpaid", "paid", "overdue", "void"],
      invoice_type: ["waybill", "batch", "monthly", "manual", "shop"],
      order_status: [
        "pending",
        "paid",
        "procurement",
        "received",
        "packed",
        "in_transit",
        "ready_pickup",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "storage",
        "arrived",
      ],
      product_purchase_type: ["personal", "business"],
      product_status: ["draft", "active", "archived"],
      promo_type: ["discount", "bundle", "flash"],
      surcharge_scope: ["waybill", "carton", "pallet", "batch", "forwarding"],
      vip_level: ["normal", "silver", "gold", "diamond", "ship", "owner"],
      waybill_status: [
        "pending",
        "received",
        "packed",
        "shipped",
        "in_transit",
        "ready_pickup",
        "delivered",
        "cancelled",
        "procurement",
        "storage",
        "arrived",
      ],
    },
  },
} as const
