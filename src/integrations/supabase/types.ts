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
          user_id: string
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
          confirmed: boolean
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          customer_code: string
          id: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_code: string
          id?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_code?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
          created_at: string
          extras: Json
          forwarding_id: string
          hs_code: string | null
          id: string
          name: string
          quantity: number
          unit_price_cad: number
          unit_price_cny: number
        }
        Insert: {
          created_at?: string
          extras?: Json
          forwarding_id: string
          hs_code?: string | null
          id?: string
          name: string
          quantity?: number
          unit_price_cad?: number
          unit_price_cny?: number
        }
        Update: {
          created_at?: string
          extras?: Json
          forwarding_id?: string
          hs_code?: string | null
          id?: string
          name?: string
          quantity?: number
          unit_price_cad?: number
          unit_price_cny?: number
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
          attrs_snapshot: Json | null
          created_at: string
          id: string
          image_url: string | null
          name_en: string | null
          name_zh: string
          order_id: string
          paid: boolean
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
          attrs_snapshot?: Json | null
          created_at?: string
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_zh: string
          order_id: string
          paid?: boolean
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
          attrs_snapshot?: Json | null
          created_at?: string
          id?: string
          image_url?: string | null
          name_en?: string | null
          name_zh?: string
          order_id?: string
          paid?: boolean
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
        Relationships: []
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
          paid_at: string | null
          pallet_id: string | null
          pallet_no: string | null
          payment_method: string | null
          payment_status: string
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
          paid_at?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_method?: string | null
          payment_status?: string
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
          paid_at?: string | null
          pallet_id?: string | null
          pallet_no?: string | null
          payment_method?: string | null
          payment_status?: string
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      product_variants: {
        Row: {
          attrs: Json
          barcode: string | null
          created_at: string
          height_cm: number | null
          id: string
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
        Relationships: []
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
      vip_level: "normal" | "silver" | "gold" | "diamond"
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
      vip_level: ["normal", "silver", "gold", "diamond"],
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
