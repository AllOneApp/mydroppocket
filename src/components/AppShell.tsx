import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, ShieldCheck, Wallet, FileText, Search, Settings, LogOut, Menu, ArrowLeft } from "lucide-react";
import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "./Logo";
import { Button } from "./ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";

const nav = [
  { to: "/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { to: "/warranties", icon: ShieldCheck, key: "warranties" },
  { to: "/expenses", icon: Wallet, key: "expenses" },
  { to: "/agreements", icon: FileText, key: "agreements" },
  { to: "/search", icon: Search, key: "search" },
  { to: "/settings", icon: Settings, key: "settings" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const showBack = location.pathname !== "/dashboard" && location.pathname !== "/";

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const Sidebar = (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4">
      <div className="mb-8 px-2 pt-2"><Logo className="h-12" /></div>
      <nav className="flex-1 space-y-1">
        {nav.map(({ to, icon: Icon, key }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {t(`nav.${key}`)}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 flex flex-col gap-2">
        <LanguageSwitcher className="self-start" />
        <Button variant="ghost" onClick={signOut} className="justify-start gap-3">
          <LogOut className="h-4 w-4" /> {t("common.signOut")}
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden md:block">{Sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0">{Sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-1 border-b border-border bg-card/50 px-2 py-2 backdrop-blur md:hidden">
          <Button
            variant="ghost"
            onClick={() => setOpen(true)}
            aria-label="Menu"
            className="h-11 w-11 shrink-0 p-0"
          >
            <Menu style={{ width: 28, height: 28 }} />
          </Button>
          {showBack && (
            <Button
              variant="ghost"
              onClick={() => window.history.back()}
              aria-label="Back"
              className="h-11 w-11 shrink-0 p-0"
            >
              <ArrowLeft style={{ width: 26, height: 26 }} />
            </Button>
          )}
          <Logo className="h-10" />
          <div className="ml-auto"><LanguageSwitcher /></div>
        </header>
        <main className="min-w-0 flex-1 p-6 md:p-10">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}