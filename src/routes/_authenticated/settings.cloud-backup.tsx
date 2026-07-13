import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, CloudUpload, RotateCcw, Check, ArrowLeft, Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  startGoogleDriveConnect,
  getGoogleDriveStatus,
  disconnectGoogleDrive,
} from "@/lib/google-drive.functions";

export const Route = createFileRoute("/_authenticated/settings/cloud-backup")({
  head: () => ({
    meta: [
      { title: "Pilve varundus — MyDropPocket" },
      { name: "description", content: "Hoia oma tähtsad dokumendid turvaliselt oma isiklikus pilves." },
      { name: "robots", content: "noindex" },
    ],
  }),
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
  const [autoBackup, setAutoBackup] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const qc = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["google-drive-status"],
    queryFn: () => getGoogleDriveStatus(),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectGoogleDrive(),
    onSuccess: () => {
      toast.success("Google Drive lahutatud");
      qc.invalidateQueries({ queryKey: ["google-drive-status"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Lahutamine ebaõnnestus");
    },
  });

  // Listen for the popup's postMessage.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; ok?: boolean; email?: string; error?: string } | null;
      if (!data || data.type !== "mydroppocket:google-drive:oauth") return;
      setConnecting(false);
      if (data.ok) {
        toast.success(`Google Drive ühendatud (${data.email ?? "OK"})`);
        qc.invalidateQueries({ queryKey: ["google-drive-status"] });
      } else {
        toast.error(`Ühendus ebaõnnestus: ${data.error ?? "tundmatu viga"}`);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc]);

  async function handleConnectGoogle() {
    // Open popup synchronously in the click handler to avoid popup blockers.
    const popup = window.open("", "mydroppocket-gdrive", "width=560,height=680");
    if (!popup) {
      toast.error("Popup blokeeriti. Luba popup'id ja proovi uuesti.");
      return;
    }
    setConnecting(true);
    try {
      const { authorizationUrl } = await startGoogleDriveConnect({
        data: { origin: window.location.origin },
      });
      popup.location.href = authorizationUrl;

      // Poll for the popup being closed manually.
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          setConnecting((c) => {
            if (c) toast.message("Sisselogimine tühistati");
            return false;
          });
        }
      }, 500);
    } catch (e) {
      popup.close();
      setConnecting(false);
      toast.error(e instanceof Error ? e.message : "Ei suuda alustada ühendust");
    }
  }

  const gdriveConnected = statusQuery.data?.connected === true;
  const gdriveEmail = gdriveConnected ? statusQuery.data.email : undefined;
  const gdriveFolder = gdriveConnected ? statusQuery.data.folderName : undefined;

  const providers: Provider[] = [
    { id: "gdrive", name: "Google Drive", platform: "Android · iOS · Web", connected: gdriveConnected },
    { id: "icloud", name: "iCloud Drive", platform: "iPhone", connected: false, comingSoon: true },
    { id: "dropbox", name: "Dropbox", platform: "Tulekul", connected: false, comingSoon: true },
    { id: "onedrive", name: "OneDrive", platform: "Tulekul", connected: false, comingSoon: true },
  ];

  const backupItems = [
    "Garantiid",
    "Tšekid",
    "Lepingud",
    "Järelmaksulepingud",
    "Tulud ja kulud",
    "Püsimaksed",
    "Pildid",
    "PDF failid",
    "AI metaandmed",
  ];

  return (
    <AppShell>
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Seaded
      </Link>

      <div className="flex items-center gap-3">
        <Cloud className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold">Pilve varundus</h1>
      </div>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Hoia oma tähtsad dokumendid turvaliselt oma isiklikus pilves. Kui telefon kaob või rakendus eemaldatakse,
        saad oma andmed hiljem taastada.
      </p>

      <div className="mt-8 grid gap-6">
        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">Ühendatavad pilveteenused</h2>
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
                          Tulekul
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
                        {p.connected ? "Ühendatud" : "Pole ühendatud"}
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
                      "Lahuta"
                    ) : (
                      "Ühenda"
                    )}
                  </Button>
                ) : (
                  <Button variant="default" disabled className="sm:w-32">
                    Ühenda
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card-soft p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Automaatne pilve varundus</h2>
              <p className="text-sm text-muted-foreground">
                Varunda uued kirjed automaatselt valitud pilveteenusesse.
              </p>
            </div>
            <Switch checked={autoBackup} onCheckedChange={setAutoBackup} />
          </div>
        </section>

        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">Varundatakse</h2>
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
          <h2 className="mb-2 text-lg font-semibold">Viimane varundus</h2>
          <p className="text-sm text-muted-foreground">Pole veel varundatud.</p>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            className="brand-gradient-bg text-primary-foreground sm:w-auto"
            disabled
          >
            <CloudUpload className="mr-2 h-4 w-4" /> Varunda kohe
          </Button>
          <Button variant="outline" disabled className="sm:w-auto">
            <RotateCcw className="mr-2 h-4 w-4" /> Taasta varukoopiast
          </Button>
        </div>
      </div>
    </AppShell>
  );
}