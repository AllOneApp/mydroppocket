import type { Database } from "@/integrations/supabase/types";

export type ProfileType = "personal" | "family" | "company" | "other";

export type UserProfile = {
  id: string;
  user_id: string;
  name: string;
  type: ProfileType;
  avatar_url: string | null;
  color: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type UserProfileRow = Database["public"]["Tables"]["user_profiles"]["Row"];

export const PROFILE_TYPE_ICONS: Record<ProfileType, string> = {
  personal: "👤",
  family: "👨‍👩‍👧",
  company: "🏢",
  other: "📁",
};

export const PROFILE_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#eab308", // yellow
  "#ef4444", // red
  "#6366f1", // indigo
  "#0ea5e9", // sky
];

export function profileInitial(p: Pick<UserProfile, "name">): string {
  const trimmed = (p.name ?? "").trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

export function activeProfileStorageKey(userId: string): string {
  return `mydroppocket.activeProfile.${userId}`;
}

export const MAX_PROFILES = 10;