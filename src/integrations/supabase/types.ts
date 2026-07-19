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
      agreement_attachments: {
        Row: {
          agreement_id: string
          created_at: string
          file_mime: string | null
          file_name: string
          file_path: string
          file_size: number | null
          gdrive_file_id: string | null
          id: string
          sort_order: number
          user_id: string
        }
        Insert: {
          agreement_id: string
          created_at?: string
          file_mime?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          gdrive_file_id?: string | null
          id?: string
          sort_order?: number
          user_id: string
        }
        Update: {
          agreement_id?: string
          created_at?: string
          file_mime?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          gdrive_file_id?: string | null
          id?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_attachments_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      agreements: {
        Row: {
          agreement_number: string | null
          agreement_type: string
          bank: string | null
          company: string | null
          created_at: string
          currency: string | null
          end_date: string | null
          file_mime: string | null
          file_name: string | null
          file_path: string | null
          gdrive_file_id: string | null
          gdrive_folder_id: string | null
          iban: string | null
          id: string
          monthly_payment: number | null
          notes: string | null
          ocr_raw: Json | null
          payee_name: string | null
          payment_day_of_month: number | null
          payments_made: number
          profile_id: string | null
          reference_number: string | null
          start_date: string | null
          title: string
          total_amount: number | null
          total_payments: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agreement_number?: string | null
          agreement_type?: string
          bank?: string | null
          company?: string | null
          created_at?: string
          currency?: string | null
          end_date?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          gdrive_file_id?: string | null
          gdrive_folder_id?: string | null
          iban?: string | null
          id?: string
          monthly_payment?: number | null
          notes?: string | null
          ocr_raw?: Json | null
          payee_name?: string | null
          payment_day_of_month?: number | null
          payments_made?: number
          profile_id?: string | null
          reference_number?: string | null
          start_date?: string | null
          title: string
          total_amount?: number | null
          total_payments?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agreement_number?: string | null
          agreement_type?: string
          bank?: string | null
          company?: string | null
          created_at?: string
          currency?: string | null
          end_date?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          gdrive_file_id?: string | null
          gdrive_folder_id?: string | null
          iban?: string | null
          id?: string
          monthly_payment?: number | null
          notes?: string | null
          ocr_raw?: Json | null
          payee_name?: string | null
          payment_day_of_month?: number | null
          payments_made?: number
          profile_id?: string | null
          reference_number?: string | null
          start_date?: string | null
          title?: string
          total_amount?: number | null
          total_payments?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          calendar_id: string
          created_at: string
          event_date: string
          google_event_id: string
          id: string
          profile_id: string | null
          sequence: number
          source_id: string
          source_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id: string
          created_at?: string
          event_date: string
          google_event_id: string
          id?: string
          profile_id?: string | null
          sequence?: number
          source_id: string
          source_type: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_id?: string
          created_at?: string
          event_date?: string
          google_event_id?: string
          id?: string
          profile_id?: string | null
          sequence?: number
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          currency: string | null
          description: string | null
          expense_date: string
          file_mime: string | null
          file_name: string | null
          file_path: string | null
          gdrive_file_id: string | null
          id: string
          notes: string | null
          ocr_raw: Json | null
          profile_id: string | null
          store: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          currency?: string | null
          description?: string | null
          expense_date?: string
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          gdrive_file_id?: string | null
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
          profile_id?: string | null
          store?: string | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          currency?: string | null
          description?: string | null
          expense_date?: string
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          gdrive_file_id?: string | null
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
          profile_id?: string | null
          store?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_connections: {
        Row: {
          access_token_ciphertext: string
          access_token_expires_at: string
          agreement_reminder_days: number[]
          calendar_id: string | null
          calendar_name: string
          connected_at: string
          google_email: string
          google_sub: string
          id: string
          profile_id: string | null
          refresh_token_ciphertext: string
          reminder_minutes: number[]
          scope: string
          sync_agreements: boolean
          sync_installments: boolean
          sync_recurring: boolean
          sync_warranties: boolean
          updated_at: string
          user_id: string
          warranty_reminder_days: number[]
        }
        Insert: {
          access_token_ciphertext: string
          access_token_expires_at: string
          agreement_reminder_days?: number[]
          calendar_id?: string | null
          calendar_name?: string
          connected_at?: string
          google_email: string
          google_sub: string
          id?: string
          profile_id?: string | null
          refresh_token_ciphertext: string
          reminder_minutes?: number[]
          scope: string
          sync_agreements?: boolean
          sync_installments?: boolean
          sync_recurring?: boolean
          sync_warranties?: boolean
          updated_at?: string
          user_id: string
          warranty_reminder_days?: number[]
        }
        Update: {
          access_token_ciphertext?: string
          access_token_expires_at?: string
          agreement_reminder_days?: number[]
          calendar_id?: string | null
          calendar_name?: string
          connected_at?: string
          google_email?: string
          google_sub?: string
          id?: string
          profile_id?: string | null
          refresh_token_ciphertext?: string
          reminder_minutes?: number[]
          scope?: string
          sync_agreements?: boolean
          sync_installments?: boolean
          sync_recurring?: boolean
          sync_warranties?: boolean
          updated_at?: string
          user_id?: string
          warranty_reminder_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      google_drive_connections: {
        Row: {
          access_token_ciphertext: string
          access_token_expires_at: string
          auto_backup: boolean
          backup_format: string
          connected_at: string
          google_email: string
          google_sub: string
          id: string
          profile_id: string
          refresh_token_ciphertext: string
          root_folder_id: string | null
          root_folder_name: string
          scope: string
          subfolders_json: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_ciphertext: string
          access_token_expires_at: string
          auto_backup?: boolean
          backup_format?: string
          connected_at?: string
          google_email: string
          google_sub: string
          id?: string
          profile_id: string
          refresh_token_ciphertext: string
          root_folder_id?: string | null
          root_folder_name?: string
          scope: string
          subfolders_json?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_ciphertext?: string
          access_token_expires_at?: string
          auto_backup?: boolean
          backup_format?: string
          connected_at?: string
          google_email?: string
          google_sub?: string
          id?: string
          profile_id?: string
          refresh_token_ciphertext?: string
          root_folder_id?: string | null
          root_folder_name?: string
          scope?: string
          subfolders_json?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_drive_connections_profile_owner_fkey"
            columns: ["profile_id", "user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      google_drive_folders: {
        Row: {
          category: string
          connection_id: string
          created_at: string
          folder_id: string
          folder_name: string
          id: string
          parent_folder_id: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          category: string
          connection_id: string
          created_at?: string
          folder_id: string
          folder_name: string
          id?: string
          parent_folder_id?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          connection_id?: string
          created_at?: string
          folder_id?: string
          folder_name?: string
          id?: string
          parent_folder_id?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_drive_folders_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "google_drive_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_drive_folders_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          language: string
          notifications_enabled: boolean
          theme: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          language?: string
          notifications_enabled?: boolean
          theme?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          language?: string
          notifications_enabled?: boolean
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      recurring_payment_instances: {
        Row: {
          amount: number
          created_at: string
          currency: string | null
          due_date: string
          expense_id: string | null
          id: string
          invoice_file_mime: string | null
          invoice_file_name: string | null
          invoice_file_path: string | null
          invoice_gdrive_file_id: string | null
          notes: string | null
          paid_at: string | null
          profile_id: string | null
          receipt_file_mime: string | null
          receipt_file_name: string | null
          receipt_file_path: string | null
          receipt_gdrive_file_id: string | null
          recurring_payment_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string | null
          due_date: string
          expense_id?: string | null
          id?: string
          invoice_file_mime?: string | null
          invoice_file_name?: string | null
          invoice_file_path?: string | null
          invoice_gdrive_file_id?: string | null
          notes?: string | null
          paid_at?: string | null
          profile_id?: string | null
          receipt_file_mime?: string | null
          receipt_file_name?: string | null
          receipt_file_path?: string | null
          receipt_gdrive_file_id?: string | null
          recurring_payment_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string | null
          due_date?: string
          expense_id?: string | null
          id?: string
          invoice_file_mime?: string | null
          invoice_file_name?: string | null
          invoice_file_path?: string | null
          invoice_gdrive_file_id?: string | null
          notes?: string | null
          paid_at?: string | null
          profile_id?: string | null
          receipt_file_mime?: string | null
          receipt_file_name?: string | null
          receipt_file_path?: string | null
          receipt_gdrive_file_id?: string | null
          recurring_payment_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_payment_instances_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_payment_instances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_payment_instances_recurring_payment_id_fkey"
            columns: ["recurring_payment_id"]
            isOneToOne: false
            referencedRelation: "recurring_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_payments: {
        Row: {
          amount: number
          bank_name: string | null
          category: string | null
          contract_file_mime: string | null
          contract_file_name: string | null
          contract_file_path: string | null
          contract_gdrive_file_id: string | null
          created_at: string
          currency: string | null
          due_day: number | null
          end_date: string | null
          frequency: string
          iban: string | null
          id: string
          linked_purchase_id: string | null
          next_due_date: string
          notes: string | null
          payee_name: string | null
          payment_description: string | null
          profile_id: string | null
          provider: string | null
          reference_number: string | null
          reminder_days_before: number
          service_name: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          bank_name?: string | null
          category?: string | null
          contract_file_mime?: string | null
          contract_file_name?: string | null
          contract_file_path?: string | null
          contract_gdrive_file_id?: string | null
          created_at?: string
          currency?: string | null
          due_day?: number | null
          end_date?: string | null
          frequency?: string
          iban?: string | null
          id?: string
          linked_purchase_id?: string | null
          next_due_date?: string
          notes?: string | null
          payee_name?: string | null
          payment_description?: string | null
          profile_id?: string | null
          provider?: string | null
          reference_number?: string | null
          reminder_days_before?: number
          service_name: string
          start_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          bank_name?: string | null
          category?: string | null
          contract_file_mime?: string | null
          contract_file_name?: string | null
          contract_file_path?: string | null
          contract_gdrive_file_id?: string | null
          created_at?: string
          currency?: string | null
          due_day?: number | null
          end_date?: string | null
          frequency?: string
          iban?: string | null
          id?: string
          linked_purchase_id?: string | null
          next_due_date?: string
          notes?: string | null
          payee_name?: string | null
          payment_description?: string | null
          profile_id?: string | null
          provider?: string | null
          reference_number?: string | null
          reminder_days_before?: number
          service_name?: string
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_payments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          calendar_mode: string
          color: string
          created_at: string
          drive_mode: string
          id: string
          is_default: boolean
          legacy_drive_migration_dismissed_at: string | null
          legacy_drive_migration_done_at: string | null
          name: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          calendar_mode?: string
          color?: string
          created_at?: string
          drive_mode?: string
          id?: string
          is_default?: boolean
          legacy_drive_migration_dismissed_at?: string | null
          legacy_drive_migration_done_at?: string | null
          name: string
          type?: Database["public"]["Enums"]["profile_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          calendar_mode?: string
          color?: string
          created_at?: string
          drive_mode?: string
          id?: string
          is_default?: boolean
          legacy_drive_migration_dismissed_at?: string | null
          legacy_drive_migration_done_at?: string | null
          name?: string
          type?: Database["public"]["Enums"]["profile_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      warranties: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          file_mime: string | null
          file_name: string | null
          file_path: string | null
          gdrive_file_id: string | null
          id: string
          notes: string | null
          ocr_raw: Json | null
          product_name: string
          profile_id: string | null
          purchase_date: string | null
          store: string | null
          updated_at: string
          user_id: string
          warranty_expiry: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          gdrive_file_id?: string | null
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
          product_name: string
          profile_id?: string | null
          purchase_date?: string | null
          store?: string | null
          updated_at?: string
          user_id: string
          warranty_expiry?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          gdrive_file_id?: string | null
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
          product_name?: string
          profile_id?: string | null
          purchase_date?: string | null
          store?: string | null
          updated_at?: string
          user_id?: string
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warranties_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      profile_type: "personal" | "family" | "company" | "other"
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
      profile_type: ["personal", "family", "company", "other"],
    },
  },
} as const
