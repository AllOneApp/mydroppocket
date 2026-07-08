import { useTranslation } from "react-i18next";
import { setLang, type Lang } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || "et").startsWith("et") ? "et" : "en";

  async function pick(lang: Lang) {
    if (lang === current) return;
    await setLang(lang);
    // Best-effort sync to profile if signed in.
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      await supabase.from("profiles").update({ language: lang }).eq("id", data.user.id);
    })();
  }

  const btn = (lang: Lang, flag: string, label: string) => (
    <button
      type="button"
      onClick={() => pick(lang)}
      aria-pressed={current === lang}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
        current === lang
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span aria-hidden>{flag}</span>
      {label}
    </button>
  );

  return (
    <div className={cn("inline-flex items-center rounded-full border border-border bg-card/70 p-0.5 backdrop-blur", className)}>
      {btn("et", "🇪🇪", "ET")}
      {btn("en", "🇬🇧", "EN")}
    </div>
  );
}