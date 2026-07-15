import { PROFILE_TYPE_ICONS, profileInitial, type UserProfile } from "@/lib/profiles";

export function ProfileAvatar({
  profile,
  size = 28,
  showTypeBadge = false,
  className = "",
}: {
  profile: Pick<UserProfile, "name" | "avatar_url" | "color" | "type"> | null;
  size?: number;
  showTypeBadge?: boolean;
  className?: string;
}) {
  if (!profile) {
    return (
      <div
        className={`rounded-full bg-muted ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  const style = { width: size, height: size, background: profile.color };
  const fontSize = Math.max(10, Math.round(size * 0.42));
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {profile.avatar_url ? (
        <img
          src={profile.avatar_url}
          alt=""
          className="h-full w-full rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={style}
        >
          <span style={{ fontSize }}>{profileInitial(profile)}</span>
        </div>
      )}
      {showTypeBadge && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background text-[10px] shadow ring-1 ring-border"
          aria-hidden
        >
          {PROFILE_TYPE_ICONS[profile.type]}
        </span>
      )}
    </div>
  );
}