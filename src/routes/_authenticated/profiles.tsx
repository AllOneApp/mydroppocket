import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Star, Users, Upload, X } from "lucide-react";
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
        <div className="grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`card-soft flex items-center gap-4 p-4 ${p.id === activeProfileId ? "ring-2 ring-primary" : ""}`}
            >
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