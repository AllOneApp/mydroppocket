import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "./ui/button";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useTranslation } from "react-i18next";

type Variant = "public" | "auth" | "app-mobile";

interface HeaderProps {
  variant: Variant;
  onMenu?: () => void;
}

/**
 * Single unified header used across every page.
 * - Fixed height ~72px
 * - Identical Logo size (h-12) everywhere
 * - One flex row, items-center, justify-between
 */
export function Header({ variant, onMenu }: HeaderProps) {
  const { t } = useTranslation();

  if (variant === "app-mobile") {
    return (
      <header className="flex h-[72px] items-center justify-between border-b border-border bg-card/50 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Menu"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent"
        >
          <Menu style={{ width: 28, height: 28 }} />
        </button>
        <Link to="/dashboard" aria-label="DropPocket" className="flex items-center">
          <Logo className="h-12" />
        </Link>
        <div className="flex h-11 shrink-0 items-center">
          <LanguageSwitcher />
        </div>
      </header>
    );
  }

  if (variant === "auth") {
    return (
      <header className="mx-auto flex h-[72px] w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="DropPocket" className="flex items-center">
          <Logo className="h-12" />
        </Link>
        <div className="flex items-center">
          <LanguageSwitcher />
        </div>
      </header>
    );
  }

  // public (landing)
  return (
    <header className="mx-auto flex h-[72px] w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
      <Link to="/" aria-label="DropPocket" className="flex items-center">
        <Logo className="h-12" />
      </Link>
      <div className="flex items-center gap-2 sm:gap-4">
        <LanguageSwitcher />
        <Link to="/auth">
          <Button variant="ghost" size="sm" className="px-2 text-xs sm:px-3 sm:text-sm">
            {t("common.signIn")}
          </Button>
        </Link>
        <Link to="/auth">
          <Button
            size="sm"
            className="brand-gradient-bg px-2.5 text-xs text-primary-foreground sm:px-4 sm:text-sm"
          >
            {t("common.getStarted")}
          </Button>
        </Link>
      </div>
    </header>
  );
}