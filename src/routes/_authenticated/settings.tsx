import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — DropPocket" }] }),
  component: SettingsPage,
});

function SettingsPage() {
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
    const { error } = await supabase.from("profiles").upsert({ id: u.user!.id, ...profile });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Saved"); applyTheme(profile.theme); }
  }

  return (
    <AppShell>
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="mt-1 text-muted-foreground">Manage your profile and preferences.</p>

      <div className="mt-8 grid gap-6">
        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">Profile</h2>
          <div className="grid gap-4">
            <div><Label>Email</Label><Input value={email} disabled /></div>
            <div><Label>Display name</Label><Input value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></div>
          </div>
        </section>

        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">Appearance</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Theme</Label>
              <Select value={profile.theme} onValueChange={(v) => setProfile({ ...profile, theme: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Language</Label>
              <Select value={profile.language} onValueChange={(v) => setProfile({ ...profile, language: v })}>
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
          <h2 className="mb-2 text-lg font-semibold">Notifications</h2>
          <div className="flex items-center justify-between gap-4 pt-2">
            <div>
              <p className="font-medium">Warranty expiry alerts</p>
              <p className="text-sm text-muted-foreground">Get notified when a warranty expires within 30 days.</p>
            </div>
            <Switch checked={profile.notifications_enabled} onCheckedChange={(v) => setProfile({ ...profile, notifications_enabled: v })} />
          </div>
        </section>

        <Button onClick={save} disabled={saving} className="w-full brand-gradient-bg text-primary-foreground sm:w-auto">{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </AppShell>
  );
}