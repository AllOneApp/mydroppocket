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
      agreements: {
        Row: {
          agreement_number: string | null
          agreement_type: string
          company: string | null
          created_at: string
          currency: string | null
          end_date: string | null
          file_mime: string | null
          file_name: string | null
          file_path: string | null
          id: string
          monthly_payment: number | null
          notes: string | null
          ocr_raw: Json | null
          start_date: string | null
          title: string
          total_amount: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agreement_number?: string | null
          agreement_type?: string
          company?: string | null
          created_at?: string
          currency?: string | null
          end_date?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          monthly_payment?: number | null
          notes?: string | null
          ocr_raw?: Json | null
          start_date?: string | null
          title: string
          total_amount?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agreement_number?: string | null
          agreement_type?: string
          company?: string | null
          created_at?: string
          currency?: string | null
          end_date?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          monthly_payment?: number | null
          notes?: string | null
          ocr_raw?: Json | null
          start_date?: string | null
          title?: string
          total_amount?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          id: string
          notes: string | null
          ocr_raw: Json | null
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
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
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
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
          store?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_drive_connections: {
        Row: {
          access_token_ciphertext: string
          access_token_expires_at: string
          connected_at: string
          google_email: string
          google_sub: string
          id: string
          refresh_token_ciphertext: string
          root_folder_id: string | null
          root_folder_name: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_ciphertext: string
          access_token_expires_at: string
          connected_at?: string
          google_email: string
          google_sub: string
          id?: string
          refresh_token_ciphertext: string
          root_folder_id?: string | null
          root_folder_name?: string
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_ciphertext?: string
          access_token_expires_at?: string
          connected_at?: string
          google_email?: string
          google_sub?: string
          id?: string
          refresh_token_ciphertext?: string
          root_folder_id?: string | null
          root_folder_name?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          id: string
          invoice_file_mime: string | null
          invoice_file_name: string | null
          invoice_file_path: string | null
          notes: string | null
          paid_at: string | null
          receipt_file_mime: string | null
          receipt_file_name: string | null
          receipt_file_path: string | null
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
          id?: string
          invoice_file_mime?: string | null
          invoice_file_name?: string | null
          invoice_file_path?: string | null
          notes?: string | null
          paid_at?: string | null
          receipt_file_mime?: string | null
          receipt_file_name?: string | null
          receipt_file_path?: string | null
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
          id?: string
          invoice_file_mime?: string | null
          invoice_file_name?: string | null
          invoice_file_path?: string | null
          notes?: string | null
          paid_at?: string | null
          receipt_file_mime?: string | null
          receipt_file_name?: string | null
          receipt_file_path?: string | null
          recurring_payment_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
          category: string | null
          contract_file_mime: string | null
          contract_file_name: string | null
          contract_file_path: string | null
          created_at: string
          currency: string | null
          end_date: string | null
          frequency: string
          id: string
          linked_purchase_id: string | null
          next_due_date: string
          notes: string | null
          provider: string | null
          reminder_days_before: number
          service_name: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          contract_file_mime?: string | null
          contract_file_name?: string | null
          contract_file_path?: string | null
          created_at?: string
          currency?: string | null
          end_date?: string | null
          frequency?: string
          id?: string
          linked_purchase_id?: string | null
          next_due_date?: string
          notes?: string | null
          provider?: string | null
          reminder_days_before?: number
          service_name: string
          start_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          contract_file_mime?: string | null
          contract_file_name?: string | null
          contract_file_path?: string | null
          created_at?: string
          currency?: string | null
          end_date?: string | null
          frequency?: string
          id?: string
          linked_purchase_id?: string | null
          next_due_date?: string
          notes?: string | null
          provider?: string | null
          reminder_days_before?: number
          service_name?: string
          start_date?: string
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
          id: string
          notes: string | null
          ocr_raw: Json | null
          product_name: string
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
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
          product_name: string
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
          id?: string
          notes?: string | null
          ocr_raw?: Json | null
          product_name?: string
          purchase_date?: string | null
          store?: string | null
          updated_at?: string
          user_id?: string
          warranty_expiry?: string | null
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
