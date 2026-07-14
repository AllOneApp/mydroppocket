import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { pickLang, setLang, type Lang } from "@/i18n";
import { Cloud, ChevronRight, Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({ meta: [{ title: "Settings — DropPocket" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState({ display_name: "", language: "en", theme: "light", notifications_enabled: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setEmail(u.user?.email ?? "");
      const { data } = await supabase.from("profiles").select("*").eq("id", u.user!.id).maybeSingle();
      if (data) setProfile({ display_name: data.display_name ?? "", language: data.language, theme: data.theme, notifications_enabled: data.notifications_enabled });
      applyTheme(data?.theme ?? "light");
    })();
  }, []);

  function applyTheme(t: string) {
    document.documentElement.classList.toggle("dark", t === "dark");
  }

  async function save() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const normalized = { ...profile, language: pickLang(profile.language) };
    const { error } = await supabase.from("profiles").upsert({ id: u.user!.id, ...normalized });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t("common.saved"));
      applyTheme(profile.theme);
      await setLang(normalized.language as Lang);
    }
  }

  return (
    <AppShell>
      <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("settings.subtitle")}</p>

      <div className="mt-8 grid gap-6">
        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("settings.profile")}</h2>
          <div className="grid gap-4">
            <div><Label>{t("settings.email")}</Label><Input value={email} disabled /></div>
            <div><Label>{t("settings.displayName")}</Label><Input value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></div>
          </div>
        </section>

        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("settings.appearance")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("settings.theme")}</Label>
              <Select value={profile.theme} onValueChange={(v) => setProfile({ ...profile, theme: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">{t("settings.light")}</SelectItem>
                  <SelectItem value="dark">{t("settings.dark")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("settings.language")}</Label>
              <Select
                value={profile.language}
                onValueChange={(v) => {
                  setProfile({ ...profile, language: v });
                  void setLang(v as Lang);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="et">Eesti</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="card-soft p-6">
          <h2 className="mb-2 text-lg font-semibold">{t("settings.notifications")}</h2>
          <div className="flex items-center justify-between gap-4 pt-2">
            <div>
              <p className="font-medium">{t("settings.warrantyAlerts")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.warrantyAlertsDesc")}</p>
            </div>
            <Switch checked={profile.notifications_enabled} onCheckedChange={(v) => setProfile({ ...profile, notifications_enabled: v })} />
          </div>
        </section>

        <Link
          to="/settings/cloud-backup"
          className="card-soft flex items-center justify-between gap-4 p-6 transition-colors hover:bg-accent/40"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Cloud className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">{t("settings.cloudBackup")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.cloudBackupDesc")}</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>

        <Link
          to="/settings/calendar-sync"
          className="card-soft flex items-center justify-between gap-4 p-6 transition-colors hover:bg-accent/40"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">
                {t("settings.calendarSync", { defaultValue: "Kalendri sünkroonimine" })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("settings.calendarSyncDesc", {
                  defaultValue: "Ühenda Google Calendar ja lase MyDropPocketil ise maksed lisada.",
                })}
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>

        <Button onClick={save} disabled={saving} className="w-full brand-gradient-bg text-primary-foreground sm:w-auto">{saving ? t("common.saving") : t("common.saveChanges")}</Button>
      </div>
    </AppShell>
  );
}