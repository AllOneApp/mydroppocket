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
 * Unified header across every page.
 * Layout: three-column grid so the logo is always visually centered
 * and left/right clusters align on the same horizontal baseline.
 * Logo size (h-[60px]) is identical on every variant.
 */
export function Header({ variant, onMenu }: HeaderProps) {
  const { t } = useTranslation();

  const rowBase =
    "grid h-[84px] w-full grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-4";

  if (variant === "app-mobile") {
    return (
      <header
        className={`${rowBase} border-b border-border bg-card/50 px-4 backdrop-blur md:hidden`}
      >
        <div className="flex items-center justify-start">
          <button
            type="button"
            onClick={onMenu}
            aria-label="Menu"
            className="mt-6 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent"
          >
            <Menu style={{ width: 28, height: 28 }} />
          </button>
        </div>
        <Link to="/dashboard" aria-label="DropPocket" className="flex items-center justify-center">
          <Logo />
        </Link>
        <div className="flex items-center justify-end">
          <LanguageSwitcher className="mt-6" />
        </div>
      </header>
    );
  }

  if (variant === "auth") {
    return (
      <>
        {/* Mobile: only language switcher + logo, same baseline */}
        <header className="mx-auto flex h-[84px] w-full max-w-6xl items-center justify-between px-4 sm:hidden">
          <LanguageSwitcher className="mt-[42px]" />
          <Link to="/" aria-label="DropPocket">
            <Logo />
          </Link>
        </header>
        {/* Desktop: keep three-column grid */}
        <header className={`${rowBase} mx-auto hidden max-w-6xl px-4 sm:grid sm:px-6`}>
          <div className="flex items-center justify-start">
            <LanguageSwitcher />
          </div>
          <Link to="/" aria-label="DropPocket" className="flex items-center justify-center">
            <Logo />
          </Link>
          <div className="flex items-center justify-end" />
        </header>
      </>
    );
  }

  // public (landing): mobile = 2-row, desktop = 3-col grid
  return (
    <>
      {/* Mobile: centered logo + action buttons row */}
      <header className="flex flex-col items-center gap-4 pb-6 pt-4 sm:hidden">
        <Link to="/" aria-label="DropPocket">
          <Logo className="h-[78px]" />
        </Link>
        <div className="flex w-full items-center justify-between">
          <LanguageSwitcher className="ml-10" />
          <div className="mr-2 -ml-2.5 flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm" className="px-2 text-xs">
                {t("common.signIn")}
              </Button>
            </Link>
            <Link to="/auth">
              <Button
                size="sm"
                className="brand-gradient-bg px-2.5 text-xs text-primary-foreground"
              >
                {t("common.getStarted")}
              </Button>
            </Link>
          </div>
        </div>
      </header>
      {/* Desktop: keep three-column grid */}
      <header className={`${rowBase} mx-auto hidden max-w-6xl px-4 sm:grid sm:px-6`}>
        <div className="flex items-center justify-start">
          <LanguageSwitcher />
        </div>
        <Link to="/" aria-label="DropPocket" className="flex items-center justify-center">
          <Logo />
        </Link>
        <div className="flex items-center justify-end gap-2 sm:gap-3">
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
    </>
  );
}