import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Star, Users, Upload, X, Cloud, Calendar as CalendarIcon, RefreshCw, ChevronDown, ChevronUp, HardDrive } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDeleteDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import {
  MAX_PROFILES,
  PROFILE_COLORS,
  PROFILE_TYPE_ICONS,
  type ProfileType,
  type UserProfile,
} from "@/lib/profiles";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  getProfileCalendarStatus,
  setProfileCalendarMode,
  startGoogleCalendarConnect,
  disconnectGoogleCalendar,
  syncCalendarNow,
} from "@/lib/google-calendar.functions";
import {
  getProfileDriveStatus,
  setProfileDriveMode,
  startGoogleDriveConnect,
  disconnectGoogleDrive,
  getProfilePendingCloudCounts,
  syncDriveExistingBatch,
} from "@/lib/google-drive.functions";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/profiles")({
  head: () => ({ meta: [{ title: "Profiilid — MyDropPocket" }] }),
  component: ProfilesPage,
});

const TYPE_LABELS: Record<ProfileType, string> = {
  personal: "Isiklik",
  family: "Pereliige",
  company: "Ettevõte",
  other: "Muu",
};

function ProfilesPage() {
  const { profiles, activeProfileId, setActiveProfileId, refetch } = useActiveProfile();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserProfile | null>(null);

  async function performDelete(p: UserProfile) {
    try {
      const { error } = await supabase.from("user_profiles").delete().eq("id", p.id);
      if (error) throw error;
      // If deleted profile was active, switch to remaining default.
      if (p.id === activeProfileId) {
        const next = profiles.find((x) => x.id !== p.id && x.is_default) ?? profiles.find((x) => x.id !== p.id);
        if (next) setActiveProfileId(next.id);
      }
      await refetch();
      void qc.invalidateQueries({ queryKey: ["user_profiles"] });
      toast.success("Profiil kustutatud");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kustutamine ebaõnnestus");
    }
  }

  const canAdd = profiles.length < MAX_PROFILES;

  return (
    <AppShell>
      <div className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">Profiilid</h1>
          <p className="mt-1 text-muted-foreground">
            Halda kuni {MAX_PROFILES} profiili — iga profiil on oma dokumentide, garantiide, kulude ja lepingutega täielikult eraldi. Praegu on {profiles.length}/{MAX_PROFILES}.
          </p>
        </div>
        <Button
          onClick={() => { setEditing(null); setOpen(true); }}
          disabled={!canAdd}
          className="shrink-0 brand-gradient-bg text-primary-foreground"
        >
          <Plus className="mr-1.5 h-4 w-4" />Lisa profiil
        </Button>
      </div>

      {profiles.length === 0 ? (
        <div className="card-soft flex flex-col items-center p-12 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">Sul ei ole veel profiile</h3>
          <p className="mt-1 text-sm text-muted-foreground">Lisa esimene profiil, et alustada.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`card-soft p-4 ${p.id === activeProfileId ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex items-center gap-4">
              <ProfileAvatar profile={p} size={48} showTypeBadge />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold">{p.name}</h3>
                  {p.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] font-medium text-yellow-700 dark:text-yellow-400">
                      <Star className="h-3 w-3 fill-current" /> Vaikeprofiil
                    </span>
                  )}
                  {p.id === activeProfileId && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Aktiivne
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {PROFILE_TYPE_ICONS[p.type]} {TYPE_LABELS[p.type]}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                {p.id !== activeProfileId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setActiveProfileId(p.id)}
                  >
                    Ava
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setEditing(p); setOpen(true); }}
                  aria-label="Muuda"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingDelete(p)}
                  disabled={profiles.length === 1}
                  aria-label="Kustuta"
                  className="text-red-600 hover:text-red-700 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              </div>
              <CloudServicesSection profile={p} />
            </div>
          ))}
        </div>
      )}

      <ProfileDialog
        key={editing?.id ?? "new"}
        open={open}
        onOpenChange={setOpen}
        row={editing}
        onSaved={async (id) => {
          await refetch();
          if (id) setActiveProfileId(id);
          void qc.invalidateQueries({ queryKey: ["user_profiles"] });
        }}
      />
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const p = pendingDelete; setPendingDelete(null); if (p) void performDelete(p); }}
      />
    </AppShell>
  );
}

function ProfileDialog({
  open, onOpenChange, row, onSaved,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  row: UserProfile | null;
  onSaved: (newId: string | null) => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    name: row?.name ?? "",
    type: (row?.type ?? "personal") as ProfileType,
    color: row?.color ?? PROFILE_COLORS[0]!,
    is_default: row?.is_default ?? false,
    avatar_url: row?.avatar_url ?? "",
  }));
  const [uploading, setUploading] = useState(false);

  async function handleAvatarFile(file: File) {
    setUploading(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${uid}/avatars/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data } = await supabase.storage.from("documents").createSignedUrl(path, 60 * 60 * 24 * 365);
      // Note: bucket is private; signed URL expires but for MVP we store storage path — see fallback below.
      // Store the storage path prefixed with "storage:" so we can regenerate a signed URL later if needed.
      setForm((f) => ({ ...f, avatar_url: data?.signedUrl ?? path }));
      toast.success("Pilt üles laetud");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Üleslaadimine ebaõnnestus");
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Profiili nimi on kohustuslik"); return; }
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      const payload = {
        user_id: uid,
        name: form.name.trim(),
        type: form.type,
        color: form.color,
        is_default: form.is_default,
        avatar_url: form.avatar_url ? form.avatar_url : null,
      };
      let newId: string | null = null;
      if (row) {
        const { error } = await supabase.from("user_profiles").update(payload).eq("id", row.id);
        if (error) throw error;
        newId = row.id;
      } else {
        const { data, error } = await supabase.from("user_profiles").insert(payload).select("id").single();
        if (error) throw error;
        newId = data?.id ?? null;
      }
      toast.success(row ? "Profiil salvestatud" : "Profiil lisatud");
      await onSaved(row ? null : newId);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Salvestamine ebaõnnestus";
      toast.error(msg);
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:w-full sm:max-w-md sm:p-6">
        <DialogHeader>
          <DialogTitle>{row ? "Muuda profiili" : "Lisa profiil"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center gap-4">
            <ProfileAvatar
              profile={{ name: form.name || "?", avatar_url: form.avatar_url || null, color: form.color, type: form.type }}
              size={64}
              showTypeBadge
            />
            <div className="flex flex-col gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Laen…" : "Vali pilt"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAvatarFile(f); }}
                />
              </label>
              {form.avatar_url && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, avatar_url: "" }))}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" /> Eemalda pilt
                </button>
              )}
            </div>
          </div>

          <div>
            <Label>Profiili nimi *</Label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="nt. Eelika, Ema, Eelika OÜ"
            />
          </div>

          <div>
            <Label>Profiili tüüp</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as ProfileType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">👤 Isiklik</SelectItem>
                <SelectItem value="family">👨‍👩‍👧 Pereliige</SelectItem>
                <SelectItem value="company">🏢 Ettevõte</SelectItem>
                <SelectItem value="other">📁 Muu</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Värv</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={`h-7 w-7 rounded-full ring-offset-2 transition ${form.color === c ? "ring-2 ring-primary" : "ring-0"}`}
                  style={{ background: c }}
                  aria-label={`Vali värv ${c}`}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              className="h-4 w-4"
            />
            <Star className="h-4 w-4 text-yellow-500" />
            <span>Määra vaikeprofiiliks (avaneb rakenduse käivitumisel)</span>
          </label>

          <Button type="submit" disabled={saving || uploading} className="w-full brand-gradient-bg text-primary-foreground">
            {saving ? "Salvestan…" : row ? "Salvesta" : "Lisa profiil"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Pilveteenused ----------

function CloudServicesSection({ profile }: { profile: UserProfile }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <Cloud className="h-4 w-4" /> Pilveteenused
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <CalendarProfileBlock profile={profile} />
          <DriveProfileBlock profile={profile} />
        </div>
      )}
    </div>
  );
}

function CalendarProfileBlock({ profile }: { profile: UserProfile }) {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["profile-calendar-status", profile.id],
    queryFn: () => getProfileCalendarStatus({ data: { profileId: profile.id } }),
  });
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; removed: number; skipped: number } | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { type?: string; ok?: boolean; error?: string } | undefined;
      if (!d || d.type !== "mydroppocket:google-calendar:oauth") return;
      setConnecting(false);
      if (d.ok) {
        toast.success("Google Calendar ühendatud");
        void qc.invalidateQueries({ queryKey: ["profile-calendar-status", profile.id] });
      } else {
        toast.error(d.error ?? "Ühendus ebaõnnestus");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, profile.id]);

  const modeMut = useMutation({
    mutationFn: (mode: "shared" | "separate") =>
      setProfileCalendarMode({ data: { profileId: profile.id, mode } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile-calendar-status", profile.id] });
      toast.success("Salvestatud");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Salvestamine ebaõnnestus"),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectGoogleCalendar({ data: { profileId: profile.id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile-calendar-status", profile.id] });
      toast.success("Ühendus katkestatud");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Katkestamine ebaõnnestus"),
  });

  async function handleConnect() {
    const popup = window.open("", `mydroppocket-gcal-${profile.id}`, "width=560,height=680");
    if (!popup) { toast.error("Palun luba hüpikaknad"); return; }
    setConnecting(true);
    try {
      const { authorizationUrl } = await startGoogleCalendarConnect({
        data: { origin: window.location.origin, profileId: profile.id },
      });
      popup.location.href = authorizationUrl;
      const timer = setInterval(() => {
        if (popup.closed) { clearInterval(timer); setConnecting(false); }
      }, 500);
    } catch (e) {
      popup.close(); setConnecting(false);
      toast.error(e instanceof Error ? e.message : "OAuth ebaõnnestus");
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const stats = await syncCalendarNow({ data: { profileId: profile.id } });
      setSyncResult(stats);
      toast.success(`Sünkroonitud (${stats.created} loodud, ${stats.updated} uuendatud)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sünkroonimine ebaõnnestus");
    } finally {
      setSyncing(false);
    }
  }

  const s = statusQ.data;
  const mode = s?.mode ?? "shared";
  const isDefault = profile.is_default;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <CalendarIcon className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Google Calendar</span>
      </div>

      {!isDefault && (
        <div className="mt-2 space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`cal-mode-${profile.id}`}
              checked={mode === "shared"}
              onChange={() => modeMut.mutate("shared")}
            />
            <span>✅ Kasuta põhiprofiili Google Calendarit</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`cal-mode-${profile.id}`}
              checked={mode === "separate"}
              onChange={() => modeMut.mutate("separate")}
            />
            <span>⭕ Ühenda teine Google Calendar</span>
          </label>
        </div>
      )}

      <div className="mt-2 text-xs text-muted-foreground">
        {s?.connected ? (
          <>🟢 Ühendatud – {s.email} · Kalender: {s.calendarName}</>
        ) : mode === "separate" ? (
          <>Ühendus puudub. Vajuta all olevat nuppu.</>
        ) : (
          <>Kasutab põhiprofiili kalendrit.</>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {mode === "separate" && !s?.connected && (
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Ühendan…" : "Ühenda Google Calendar"}
          </Button>
        )}
        {mode === "separate" && s?.connected && (
          <Button size="sm" variant="outline" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}>
            Katkesta ühendus
          </Button>
        )}
        {s?.connected && (
          <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sünkroonin…" : "Sünkrooni olemasolevad"}
          </Button>
        )}
      </div>

      {syncResult && (
        <div className="mt-2 text-xs text-muted-foreground">
          Loodud: {syncResult.created} · Uuendatud: {syncResult.updated} · Eemaldatud: {syncResult.removed} · Vahele jäetud: {syncResult.skipped}
        </div>
      )}
    </div>
  );
}

function PostConnectSyncPrompt({
  open, count, service, onConfirm, onDismiss,
}: { open: boolean; count: number; service: "calendar" | "drive"; onConfirm: () => void; onDismiss: () => void }) {
  const isCal = service === "calendar";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isCal ? "📅 Google Calendar ühendatud!" : "💾 Google Drive ühendatud!"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {isCal
            ? "Selles profiilis on olemas varasemad sündmused. Kas soovid need kohe Google Calendarisse sünkroonida?"
            : `Selles profiilis on ${count} dokumenti, mida pole veel Google Drive'i laetud. Kas soovid need kohe sünkroonida?`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onDismiss}>Hiljem</Button>
          <Button size="sm" onClick={onConfirm}>✅ Sünkrooni kohe</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DriveProfileBlock({ profile }: { profile: UserProfile }) {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["profile-drive-status", profile.id],
    queryFn: () => getProfileDriveStatus({ data: { profileId: profile.id } }),
  });
  const [connecting, setConnecting] = useState(false);
  const [prompt, setPrompt] = useState<{ open: boolean; count: number }>({ open: false, count: 0 });
  const [progress, setProgress] = useState<{ open: boolean; total: number; done: number; uploaded: number; failed: number; skipped: number; finished: boolean; cancel: boolean }>({
    open: false, total: 0, done: 0, uploaded: 0, failed: 0, skipped: 0, finished: false, cancel: false,
  });

  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      const d = e.data as { type?: string; ok?: boolean; error?: string } | undefined;
      if (!d || d.type !== "mydroppocket:google-drive:oauth") return;
      setConnecting(false);
      if (!d.ok) { toast.error(d.error ?? "Ühendus ebaõnnestus"); return; }
      toast.success("Google Drive ühendatud");
      await qc.invalidateQueries({ queryKey: ["profile-drive-status", profile.id] });
      // Küsi kohe: kas sünkroonida varem lisatud dokumendid?
      try {
        const counts = await getProfilePendingCloudCounts({ data: { profileId: profile.id } });
        if (counts.driveUnsynced > 0) setPrompt({ open: true, count: counts.driveUnsynced });
      } catch { /* ignore */ }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, profile.id]);

  const modeMut = useMutation({
    mutationFn: (mode: "shared" | "separate") => setProfileDriveMode({ data: { profileId: profile.id, mode } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["profile-drive-status", profile.id] }); toast.success("Salvestatud"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Salvestamine ebaõnnestus"),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectGoogleDrive({ data: { profileId: profile.id } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["profile-drive-status", profile.id] }); toast.success("Ühendus katkestatud"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Katkestamine ebaõnnestus"),
  });

  async function handleConnect() {
    const popup = window.open("", `mydroppocket-gdrive-${profile.id}`, "width=560,height=680");
    if (!popup) { toast.error("Palun luba hüpikaknad"); return; }
    setConnecting(true);
    try {
      const { authorizationUrl } = await startGoogleDriveConnect({
        data: { origin: window.location.origin, profileId: profile.id },
      });
      popup.location.href = authorizationUrl;
      const timer = setInterval(() => { if (popup.closed) { clearInterval(timer); setConnecting(false); } }, 500);
    } catch (e) {
      popup.close(); setConnecting(false);
      toast.error(e instanceof Error ? e.message : "OAuth ebaõnnestus");
    }
  }

  async function startBulkSync() {
    // Loenda esmalt palju on üldse teha (progressiriba jaoks).
    const counts = await getProfilePendingCloudCounts({ data: { profileId: profile.id } }).catch(() => ({ driveUnsynced: 0 }));
    const total = counts.driveUnsynced;
    if (total === 0) { toast.info("Sünkroonimist ootavaid dokumente ei ole"); return; }
    setProgress({ open: true, total, done: 0, uploaded: 0, failed: 0, skipped: 0, finished: false, cancel: false });

    let cursor: any = undefined;
    let uploaded = 0, failed = 0, skipped = 0, done = 0;
    // Snapshot for cancellation
    let cancelled = false;
    const cancelChecker = { get: () => cancelled };
    setProgress((p) => ({ ...p, open: true }));
    // Loop
    while (true) {
      if (cancelChecker.get()) break;
      const res: any = await syncDriveExistingBatch({ data: { profileId: profile.id, cursor, batchSize: 5 } })
        .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
      if (res?.error) { toast.error(res.error); break; }
      uploaded += res.uploaded ?? 0;
      failed += res.failed ?? 0;
      skipped += res.skipped ?? 0;
      done = uploaded + failed + skipped;
      cursor = res.cursor;
      setProgress({ open: true, total, done, uploaded, failed, skipped, finished: !!res.done, cancel: false });
      if (res.done) break;
    }
    setProgress((p) => ({ ...p, finished: true }));
  }

  const s = statusQ.data;
  const mode = s?.mode ?? "shared";
  const isDefault = profile.is_default;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Google Drive</span>
      </div>

      {!isDefault && (
        <div className="mt-2 space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name={`drv-mode-${profile.id}`} checked={mode === "shared"} onChange={() => modeMut.mutate("shared")} />
            <span>✅ Kasuta põhiprofiili Google Drive'i</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name={`drv-mode-${profile.id}`} checked={mode === "separate"} onChange={() => modeMut.mutate("separate")} />
            <span>⭕ Ühenda teine Google Drive</span>
          </label>
        </div>
      )}

      <div className="mt-2 text-xs text-muted-foreground">
        {s?.connected ? (
          <>🟢 Ühendatud{s.email ? ` – ${s.email}` : ""} · Salvestuskoht: {s.storagePath}</>
        ) : mode === "separate" ? (
          <>Ühendus puudub.</>
        ) : (
          <>Salvestuskoht: {s?.storagePath ?? `MyDropPocket / ${profile.name}`}</>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {mode === "separate" && !s?.connected && (
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Ühendan…" : "Ühenda Google Drive"}
          </Button>
        )}
        {mode === "separate" && s?.connected && (
          <Button size="sm" variant="outline" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}>
            Katkesta ühendus
          </Button>
        )}
        {s?.connected && (
          <Button size="sm" variant="secondary" onClick={startBulkSync} disabled={progress.open && !progress.finished}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${progress.open && !progress.finished ? "animate-spin" : ""}`} />
            Sünkrooni olemasolevad dokumendid
          </Button>
        )}
      </div>

      <PostConnectSyncPrompt
        open={prompt.open}
        count={prompt.count}
        service="drive"
        onDismiss={() => setPrompt({ open: false, count: 0 })}
        onConfirm={() => { setPrompt({ open: false, count: 0 }); void startBulkSync(); }}
      />

      <Dialog open={progress.open} onOpenChange={(o) => { if (!o && progress.finished) setProgress((p) => ({ ...p, open: false })); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sünkroonin Google Drive'iga</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
            <div className="text-sm text-muted-foreground">
              {progress.done} / {progress.total} · Laetud: {progress.uploaded} · Vahele jäetud: {progress.skipped} · Vigu: {progress.failed}
            </div>
            {progress.finished ? (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setProgress((p) => ({ ...p, open: false }))}>Sulge</Button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Palun ära sulge akent…</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}