import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, ArrowLeft, Loader2, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  startGoogleCalendarConnect,
  getGoogleCalendarStatus,
  disconnectGoogleCalendar,
  updateCalendarSettings,
  syncCalendarNow,
} from "@/lib/google-calendar.functions";

export const Route = createFileRoute("/_authenticated/settings/calendar-sync")({
  head: () => ({ meta: [{ title: "Kalendri sünkroonimine — MyDropPocket" }, { name: "robots", content: "noindex" }] }),
  component: CalendarSyncPage,
});

const REMINDER_OPTIONS: { minutes: number; labelKey: string; defaultLabel: string }[] = [
  { minutes: 30, labelKey: "calendarSync.reminder.30m", defaultLabel: "30 minutit enne" },
  { minutes: 60, labelKey: "calendarSync.reminder.1h", defaultLabel: "1 tund enne" },
  { minutes: 1440, labelKey: "calendarSync.reminder.1d", defaultLabel: "1 päev enne" },
  { minutes: 4320, labelKey: "calendarSync.reminder.3d", defaultLabel: "3 päeva enne" },
  { minutes: 10080, labelKey: "calendarSync.reminder.1w", defaultLabel: "1 nädal enne" },
];

function CalendarSyncPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const status = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: () => getGoogleCalendarStatus(),
  });

  const data = status.data;
  const connected = data?.connected === true;
  const email = data?.connected ? data.email : undefined;
  const syncInstallments = data?.connected ? data.syncInstallments : true;
  const reminderMinutes: number[] = data?.connected ? data.reminderMinutes : [1440];
  const syncRecurring = data?.connected ? (data as unknown as { syncRecurring?: boolean }).syncRecurring ?? true : true;
  const syncWarranties = data?.connected ? (data as unknown as { syncWarranties?: boolean }).syncWarranties ?? true : true;
  const syncAgreements = data?.connected ? (data as unknown as { syncAgreements?: boolean }).syncAgreements ?? true : true;

  const disconnectMut = useMutation({
    mutationFn: () => disconnectGoogleCalendar(),
    onSuccess: () => {
      toast.success(t("calendarSync.disconnected", { defaultValue: "Ühendus katkestatud" }));
      qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("common.failed", { defaultValue: "Ebaõnnestus" })),
  });

  const updateMut = useMutation({
    mutationFn: (patch: { syncInstallments?: boolean; reminderMinutes?: number[] }) =>
      updateCalendarSettings({ data: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("common.failed", { defaultValue: "Ebaõnnestus" })),
  });

  const syncMut = useMutation({
    mutationFn: () => syncCalendarNow(),
    onSuccess: (r) => {
      toast.success(
        t("calendarSync.synced", {
          defaultValue: "Sünkroonitud: {{created}} uut, {{updated}} uuendatud, {{removed}} eemaldatud",
          created: r.created,
          updated: r.updated,
          removed: r.removed,
        }),
      );
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("common.failed", { defaultValue: "Ebaõnnestus" })),
  });

  // Listen for popup postMessage
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; ok?: boolean; email?: string; error?: string } | null;
      if (!data || data.type !== "mydroppocket:google-calendar:oauth") return;
      setConnecting(false);
      if (data.ok) {
        toast.success(
          t("calendarSync.connectedToast", {
            defaultValue: "Google Calendar ühendatud: {{email}}",
            email: data.email ?? "OK",
          }),
        );
        qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
        // Immediately run a first sync so existing installments appear.
        setTimeout(() => syncMut.mutate(), 300);
      } else {
        toast.error(
          t("calendarSync.connectFailed", {
            defaultValue: "Ühendus ebaõnnestus: {{error}}",
            error: data.error ?? "?",
          }),
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  async function handleConnect() {
    const popup = window.open("", "mydroppocket-gcal", "width=560,height=680");
    if (!popup) {
      toast.error(t("calendarSync.popupBlocked", { defaultValue: "Palun luba hüpikaknad" }));
      return;
    }
    setConnecting(true);
    try {
      const { authorizationUrl } = await startGoogleCalendarConnect({
        data: { origin: window.location.origin },
      });
      popup.location.href = authorizationUrl;
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          setConnecting((c) => c && false);
        }
      }, 500);
    } catch (e) {
      popup.close();
      setConnecting(false);
      toast.error(e instanceof Error ? e.message : "Cannot start OAuth");
    }
  }

  function toggleReminder(min: number) {
    const set = new Set(reminderMinutes);
    if (set.has(min)) set.delete(min);
    else set.add(min);
    const next = Array.from(set).sort((a, b) => a - b);
    updateMut.mutate({ reminderMinutes: next.length > 0 ? next : [1440] });
  }

  return (
    <AppShell>
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("calendarSync.backTo", { defaultValue: "Seadete juurde" })}
      </Link>

      <div className="flex items-center gap-3">
        <Calendar className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold">
          {t("calendarSync.title", { defaultValue: "Kalendri sünkroonimine" })}
        </h1>
      </div>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        {t("calendarSync.subtitle", {
          defaultValue:
            "Sünkrooni MyDropPocketi maksed automaatselt Google Calendarisse eraldi „MyDropPocket” kalendris.",
        })}
      </p>

      <div className="mt-8 grid gap-6">
        <section className="card-soft p-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">📅 Google Calendar</p>
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                  />
                  <span className="text-muted-foreground">
                    {connected
                      ? t("calendarSync.connected", { defaultValue: "Ühendatud" })
                      : t("calendarSync.notConnected", { defaultValue: "Ühendamata" })}
                  </span>
                </div>
                {connected && email && <p className="mt-1 text-xs text-foreground/80">{email}</p>}
              </div>
            </div>
            <Button
              variant={connected ? "outline" : "default"}
              disabled={connecting || disconnectMut.isPending || status.isLoading}
              onClick={() => (connected ? disconnectMut.mutate() : handleConnect())}
              className="sm:w-32"
            >
              {connecting || disconnectMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : connected ? (
                t("calendarSync.disconnect", { defaultValue: "Lahuta" })
              ) : (
                t("calendarSync.connect", { defaultValue: "Ühenda" })
              )}
            </Button>
          </div>
        </section>

        <section className="card-soft p-6">
          <h2 className="mb-4 text-lg font-semibold">
            {t("calendarSync.optionsTitle", { defaultValue: "Mida sünkroonida" })}
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">💳 {t("calendarSync.opt.installments", { defaultValue: "Järelmaksude maksed" })}</p>
                <p className="text-sm text-muted-foreground">
                  {t("calendarSync.opt.installmentsDesc", {
                    defaultValue: "Iga järelmaksu järgmine makse ilmub kalendrisse kogu päeva sündmusena.",
                  })}
                </p>
              </div>
              <Switch
                checked={syncInstallments}
                disabled={!connected || updateMut.isPending}
                onCheckedChange={(v) => updateMut.mutate({ syncInstallments: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">📅 {t("calendarSync.opt.recurring", { defaultValue: "Püsimaksed" })}</p>
                <p className="text-sm text-muted-foreground">
                  {t("calendarSync.opt.recurringDesc", {
                    defaultValue: "Iga püsimakse järgmine tähtaeg (telefon, elekter, internet jne).",
                  })}
                </p>
              </div>
              <Switch
                checked={syncRecurring}
                disabled={!connected || updateMut.isPending}
                onCheckedChange={(v) => updateMut.mutate({ syncRecurring: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">🛡️ {t("calendarSync.opt.warranties", { defaultValue: "Garantii aegumised" })}</p>
                <p className="text-sm text-muted-foreground">
                  {t("calendarSync.opt.warrantiesDesc", {
                    defaultValue: "Meeldetuletused 30 päeva, 7 päeva ja lõpetamise päeval.",
                  })}
                </p>
              </div>
              <Switch
                checked={syncWarranties}
                disabled={!connected || updateMut.isPending}
                onCheckedChange={(v) => updateMut.mutate({ syncWarranties: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">📄 {t("calendarSync.opt.agreements", { defaultValue: "Lepingute lõppemine" })}</p>
                <p className="text-sm text-muted-foreground">
                  {t("calendarSync.opt.agreementsDesc", {
                    defaultValue: "Meeldetuletused 30 päeva, 7 päeva ja lõppemise päeval.",
                  })}
                </p>
              </div>
              <Switch
                checked={syncAgreements}
                disabled={!connected || updateMut.isPending}
                onCheckedChange={(v) => updateMut.mutate({ syncAgreements: v })}
              />
            </div>
          </div>
        </section>

        <section className="card-soft p-6">
          <h2 className="mb-1 text-lg font-semibold">
            {t("calendarSync.remindersTitle", { defaultValue: "Meeldetuletused" })}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("calendarSync.remindersDesc", {
              defaultValue: "Vali, millal Google Calendar sind sündmuse eest hoiatab.",
            })}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {REMINDER_OPTIONS.map((opt) => {
              const checked = reminderMinutes.includes(opt.minutes);
              return (
                <button
                  key={opt.minutes}
                  type="button"
                  disabled={!connected || updateMut.isPending}
                  onClick={() => toggleReminder(opt.minutes)}
                  className={`flex items-center justify-between rounded-lg border p-3 text-left text-sm transition ${
                    checked ? "border-primary bg-primary/10" : "hover:bg-muted"
                  } disabled:opacity-50`}
                >
                  <span>{t(opt.labelKey, { defaultValue: opt.defaultLabel })}</span>
                  {checked && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            className="brand-gradient-bg text-primary-foreground sm:w-auto"
            disabled={!connected || syncMut.isPending}
            onClick={() => syncMut.mutate()}
          >
            {syncMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t("calendarSync.syncNow", { defaultValue: "Sünkrooni nüüd" })}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}