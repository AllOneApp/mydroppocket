import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { InstallmentsCard } from "@/components/InstallmentsCard";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/installments")({
  head: () => ({ meta: [{ title: "Installments — DropPocket" }] }),
  component: InstallmentsPage,
});

function InstallmentsPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">
          {t("installments.title", { defaultValue: "Järelmaksud" })}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {t("installments.pageDesc", {
            defaultValue: "Kõik aktiivsed järelmaksud ja järgmised maksed ühes kohas.",
          })}
        </p>
      </div>
      <InstallmentsCard fullPage />
    </AppShell>
  );
}