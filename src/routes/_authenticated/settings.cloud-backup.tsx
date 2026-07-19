import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, CloudUpload, RotateCcw, Check, ArrowLeft, Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { formatDate } from "@/lib/format";
import { useActiveProfile } from "@/hooks/useActiveProfile";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  startGoogleDriveConnect,
  getGoogleDriveStatus,
  disconnectGoogleDrive,
  syncBackupAll,
  currentBackupLang,
  setBackupFormat,
  type BackupFormat,
} from "@/lib/google-drive.functions";

export const Route = createFileRoute("/_authenticated/settings/cloud-backup")({
  head: () => {
    const title = i18n.t("cloudBackup.title");
    return {
      meta: [
        { title: `${title} — MyDropPocket` },
        { name: "description", content: i18n.t("cloudBackup.subtitle") },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: CloudBackupPage,
});

type Provider = {
  id: string;
  name: string;
  platform: string;
  connected: boolean;
  comingSoon?: boolean;
};

function CloudBackupPage() {
  const { t } = useTranslation();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const [autoBackup, setAutoBackup] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [lastBackup, setLastBackup] = useState<{ at: string; entries: number; files: number } | null>(null);
  const qc = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["google-drive-status", activeProfileId],
    enabled: !!activeProfileId,
    queryFn: () => getGoogleDriveStatus({ data: { profileId: activeProfileId! } }),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectGoogleDrive({ data: { profileId: activeProfileId! } }),
    onSuccess: () => {
      toast.success(t("cloudBackup.disconnected"));
      qc.invalidateQueries({ queryKey: ["google-drive-status"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : t("cloudBackup.disconnectFailed"));
    },
  });

  const formatMut = useMutation({
    mutationFn: (format: BackupFormat) => setBackupFormat({ data: { profileId: activeProfileId!, format } }),
    onSuccess: () => {
      toast.success("Varunduse formaat salvestatud");
      qc.invalidateQueries({ queryKey: ["google-drive-status"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Salvestamine ebaõnnestus"),
  });

  async function runFullBackup() {
    if (!activeProfileId) return;
    setBackingUp(true);
    try {
      const res = await syncBackupAll({ data: { lang: currentBackupLang(), profileId: activeProfileId } });
      if ("skipped" in res && res.skipped) {
        toast.error(t("cloudBackup.notConnectedToast"));
        return;
      }
      if ("ok" in res && res.ok) {
        setLastBackup({ at: new Date().toISOString(), entries: res.entries, files: res.files });
        toast.success(t("cloudBackup.backedUp", { entries: res.entries, files: res.files }));
      } else if ("ok" in res) {
        const failed: string[] = [];
        if (!res.excel.success) failed.push("Excel");
        if (!res.pdf.success) failed.push("PDF");
        if (res.originalFiles.failed > 0) failed.push(`${res.originalFiles.failed} originaalfaili`);
        toast.error(`Varundus jäi osaliseks: ${failed.join(", ")}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("cloudBackup.backupFailed"));
    } finally {
      setBackingUp(false);
    }
  }

  // Listen for the popup's postMessage.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; ok?: boolean; email?: string; error?: string } | null;
      if (!data || data.type !== "mydroppocket:google-drive:oauth") return;
      setConnecting(false);
      if (data.ok) {
        toast.success(t("cloudBackup.connectedToast", { email: data.email ?? "OK" }));
        qc.invalidateQueries({ queryKey: ["google-drive-status"] });
      } else {
        toast.error(t("cloudBackup.connectFailed", { error: data.error ?? t("cloudBackup.unknownError") }));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc]);

  async function handleConnectGoogle() {
    // Open popup synchronously in the click handler to avoid popup blockers.
    const popup = window.open("", "mydroppocket-gdrive", "width=560,height=680");
    if (!popup) {
      toast.error(t("cloudBackup.popupBlocked"));
      return;
    }
    setConnecting(true);
    try {
      const { authorizationUrl } = await startGoogleDriveConnect({
        data: { origin: window.location.origin, profileId: activeProfileId! },
      });
      popup.location.href = authorizationUrl;

      // Poll for the popup being closed manually.
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          setConnecting((c) => {
            if (c) toast.message(t("cloudBackup.signInCancelled"));
            return false;
          });
        }
      }, 500);
    } catch (e) {
      popup.close();
      setConnecting(false);
      toast.error(e instanceof Error ? e.message : t("cloudBackup.cannotStart"));
    }
  }

  const gdriveStatus = statusQuery.data;
  const gdriveConnected = gdriveStatus?.connected === true;
  const gdriveEmail = gdriveStatus?.connected ? gdriveStatus.email : undefined;
  const gdriveFolder = gdriveStatus?.connected ? gdriveStatus.folderName : undefined;

  const providers: Provider[] = [
    { id: "gdrive", name: "Google Drive", platform: t("cloudBackup.platform.androidIosWeb"), connected: gdriveConnected },
    { id: "icloud", name: "iCloud Drive", platform: t("cloudBackup.platform.iphone"), connected: false, comingSoon: true },
    { id: "dropbox", name: "Dropbox", platform: t("cloudBackup.platform.comingSoon"), connected: false, comingSoon: true },
    { id: "onedrive", name: "OneDrive", platform: t("cloudBackup.platform.comingSoon"), connected: false, comingSoon: true },
  ];

  const backupItems = [
    t("cloudBackup.items.warranties"),
    t("cloudBackup.items.receipts"),
    t("cloudBackup.items.agreements"),
    t("cloudBackup.items.installments"),
    t("cloudBackup.items.expenses"),
    t("cloudBackup.items.recurring"),
    t("cloudBackup.items.images"),
    t("cloudBackup.items.pdfs"),
    t("cloudBackup.items.aiMeta"),
  ];

  return (
    <AppShell>
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("cloudBackup.backTo")}
      </Link>

      <div className="flex items-center gap-3">
        <Cloud className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold">{t("cloudBackup.title")}</h1>
      </div>
      {activeProfile && <p className="mt-1 text-sm text-muted-foreground">Profiil: {activeProfile.name}</p>}
      <p className="mt-2 max-w-2xl text-muted-foreground">{t("cloudBackup.subtitle")}</p>

      <div className="mt-8 grid gap-6">
        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("cloudBackup.providersTitle")}</h2>
          <div className="grid gap-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Cloud className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{p.name}</p>
                      {p.comingSoon && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {t("cloudBackup.comingSoon")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.platform}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          p.connected ? "bg-emerald-500" : "bg-muted-foreground/40"
                        }`}
                      />
                      <span className="text-muted-foreground">
                        {p.connected ? t("cloudBackup.connected") : t("cloudBackup.notConnected")}
                      </span>
                    </div>
                    {p.id === "gdrive" && gdriveConnected && (
                      <div className="mt-1.5 space-y-0.5">
                        {gdriveEmail && (
                          <p className="text-xs text-foreground/80">{gdriveEmail}</p>
                        )}
                        {gdriveFolder && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <FolderOpen className="h-3 w-3" /> {gdriveFolder}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {p.id === "gdrive" ? (
                  <Button
                    variant={p.connected ? "outline" : "default"}
                    disabled={connecting || disconnectMut.isPending || statusQuery.isLoading}
                    onClick={() => (p.connected ? disconnectMut.mutate() : handleConnectGoogle())}
                    className="sm:w-32"
                  >
                    {connecting || disconnectMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : p.connected ? (
                      t("cloudBackup.disconnect")
                    ) : (
                      t("cloudBackup.connect")
                    )}
                  </Button>
                ) : (
                  <Button variant="default" disabled className="sm:w-32">
                    {t("cloudBackup.connect")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card-soft p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t("cloudBackup.autoTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("cloudBackup.autoDesc")}</p>
            </div>
            <Switch checked={autoBackup} onCheckedChange={setAutoBackup} />
          </div>
        </section>

        {gdriveConnected && (
          <section className="card-soft p-6">
            <h2 className="mb-1 text-lg font-semibold">Varunduse formaat</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Kehtib ainult genereeritud koondaruannetele. Originaalfailid (PDF-tšekid, JPG/PNG) sünkroonitakse alati eraldi originaalidena.
            </p>
            <select
              className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={gdriveStatus?.backupFormat ?? "excel_pdf"}
              onChange={(e) => formatMut.mutate(e.target.value as BackupFormat)}
              disabled={formatMut.isPending}
            >
              <option value="excel_pdf">Excel + PDF (soovitatud)</option>
              <option value="excel_only">Ainult Excel</option>
              <option value="pdf_only">Ainult PDF</option>
            </select>
          </section>
        )}

        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("cloudBackup.itemsTitle")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {backupItems.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card-soft p-6">
          <h2 className="mb-2 text-lg font-semibold">{t("cloudBackup.lastTitle")}</h2>
          {lastBackup ? (
            <p className="text-sm text-muted-foreground">
              {formatDate(lastBackup.at)} · {t("cloudBackup.backedUp", { entries: lastBackup.entries, files: lastBackup.files })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("cloudBackup.lastAuto")}</p>
          )}
        </section>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            className="brand-gradient-bg text-primary-foreground sm:w-auto"
            disabled={!gdriveConnected || backingUp}
            onClick={runFullBackup}
          >
            {backingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
            {backingUp ? t("cloudBackup.backingUp") : t("cloudBackup.backupNow")}
          </Button>
          <Button variant="outline" disabled className="sm:w-auto">
            <RotateCcw className="mr-2 h-4 w-4" /> {t("cloudBackup.restore")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}