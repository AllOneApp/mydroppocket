import { Link } from "@tanstack/react-router";
import { ChevronDown, Plus, Settings2, Star } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { ProfileAvatar } from "./ProfileAvatar";

export function ProfileSwitcher({ variant = "sidebar" }: { variant?: "sidebar" | "header" }) {
  const { profiles, activeProfile, setActiveProfileId } = useActiveProfile();
  if (profiles.length === 0) return null;

  const triggerClass =
    variant === "sidebar"
      ? "flex w-full items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
      : "flex items-center gap-2 rounded-full border border-border bg-card/70 px-2 py-1 text-xs font-medium hover:bg-accent";

  const avatarSize = variant === "sidebar" ? 28 : 22;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClass} aria-label="Vaheta profiili">
          <ProfileAvatar profile={activeProfile} size={avatarSize} showTypeBadge />
          <span className="min-w-0 flex-1 truncate">{activeProfile?.name ?? "—"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Profiilid
        </DropdownMenuLabel>
        {profiles.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setActiveProfileId(p.id)}
            className="flex items-center gap-2"
          >
            <ProfileAvatar profile={p} size={22} showTypeBadge />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.is_default && <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-500 text-yellow-500" aria-label="Vaikeprofiil" />}
            {p.id === activeProfile?.id && (
              <span className="ml-1 text-[10px] font-medium text-primary">✓</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profiles" className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Lisa profiil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/profiles" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Halda profiile
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}