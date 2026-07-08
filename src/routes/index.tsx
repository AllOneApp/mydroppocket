import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Wallet, FileText, ArrowRight, Sparkles, Lock, Search } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <header className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-4 py-4 sm:px-6 sm:py-5">
        <Link to="/" className="flex min-w-0 items-center" aria-label="DropPocket">
          <Logo className="h-10 sm:h-14 md:h-16" />
        </Link>
        <div className="flex shrink-0 items-center gap-1.5 pb-1 sm:gap-2 sm:pb-2">
          <LanguageSwitcher />
          <Link to="/auth" className="hidden sm:inline-flex"><Button variant="ghost" size="sm" className="px-3">{t("common.signIn")}</Button></Link>
          <Link to="/auth"><Button size="sm" className="brand-gradient-bg px-3 text-primary-foreground sm:px-4">{t("common.getStarted")}</Button></Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="pt-10 pb-20 text-center sm:pt-20 sm:pb-24">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> {t("landing.badge")}
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            {t("landing.titleA")}<span className="bg-gradient-to-br from-primary to-blue-800 bg-clip-text text-transparent">{t("landing.titleB")}</span>.
          </h1>
          <div className="card-soft mx-auto mt-8 max-w-4xl px-6 py-6 sm:px-10 sm:py-8">
            <p className="text-base leading-relaxed text-foreground sm:text-lg">
              Garantiitšekid ei pea enam seisma sahtlis ega pleekima aja jooksul. MyDropPocket aitab sul kõik ostutšekid, garantiid ja järelmaksulepingud turvaliselt ühte kohta salvestada. Leia vajalik dokument sekunditega otsingu või häälkäskluse abil ning prindi või saada see e-postiga edasi alati siis, kui seda vajad. Nii on sinu olulised ostudokumendid alati alles ja käepärast.
            </p>
          </div>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">{t("landing.subtitle")}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="brand-gradient-bg text-primary-foreground shadow-lg">
                {t("common.startFree")} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="#features"><Button size="lg" variant="outline">{t("common.learnMore")}</Button></a>
          </div>
        </section>

        <section id="features" className="grid gap-6 pb-24 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: t("landing.warranties.title"), desc: t("landing.warranties.desc") },
            { icon: Wallet, title: t("landing.expenses.title"), desc: t("landing.expenses.desc") },
            { icon: FileText, title: t("landing.agreements.title"), desc: t("landing.agreements.desc") },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="card-soft p-6">
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl brand-gradient-bg text-primary-foreground">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 pb-24 sm:grid-cols-2">
          <div className="card-soft p-6">
            <Lock className="mb-3 h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">{t("landing.originals.title")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t("landing.originals.desc")}</p>
          </div>
          <div className="card-soft p-6">
            <Search className="mb-3 h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">{t("landing.oneSearch.title")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t("landing.oneSearch.desc")}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} DropPocket
      </footer>
    </div>
  );
}
