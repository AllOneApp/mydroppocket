import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Smartphone, Zap, Maximize2, FolderOpen } from "lucide-react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISS_KEY = "dp_install_dismissed_until";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (!isMobile()) return;
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (until && Date.now() < until) return;

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // iOS never fires beforeinstallprompt — show the sheet after a small delay.
    let iosTimer: number | undefined;
    if (isIOS()) {
      iosTimer = window.setTimeout(() => setOpen(true), 1200);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      if (iosTimer) window.clearTimeout(iosTimer);
    };
  }, []);

  function later() {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 14 * 24 * 60 * 60 * 1000));
    setOpen(false);
  }

  async function installNow() {
    if (!deferred) {
      setShowInstructions(true);
      return;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") {
      setOpen(false);
    }
    setDeferred(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) later(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl brand-gradient-bg text-primary-foreground">
            <Smartphone className="h-6 w-6" />
          </div>
          <DialogTitle className="text-xl">{t("install.title")}</DialogTitle>
          <DialogDescription>{t("install.desc")}</DialogDescription>
        </DialogHeader>

        {!showInstructions ? (
          <>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" />{t("install.benefit1")}</li>
              <li className="flex items-center gap-2"><Maximize2 className="h-4 w-4 text-primary" />{t("install.benefit2")}</li>
              <li className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" />{t("install.benefit3")}</li>
              <li className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-primary" />{t("install.benefit4")}</li>
            </ul>
            <div className="mt-4 flex flex-col gap-2">
              {(deferred || !isIOS()) && (
                <Button className="w-full brand-gradient-bg text-primary-foreground" onClick={installNow}>
                  {t("install.installNow")}
                </Button>
              )}
              <Button variant="outline" onClick={() => setShowInstructions(true)}>{t("install.showHow")}</Button>
              <Button variant="ghost" onClick={later}>{t("install.later")}</Button>
            </div>
          </>
        ) : (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              {(isIOS() ? t("install.iosSteps", { returnObjects: true }) as string[] : t("install.androidSteps", { returnObjects: true }) as string[]).map(
                (step: string, i: number) => (
                  <li key={i}>{step}</li>
                ),
              )}
            </ol>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="outline" onClick={() => setShowInstructions(false)}>{t("common.cancel")}</Button>
              <Button variant="ghost" onClick={later}>{t("install.later")}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}