import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import "@/i18n";
import { useTranslation } from "react-i18next";
import { pickLang, setLang, type Lang } from "@/i18n";
import { registerPwa } from "@/pwa/register";
import { InstallPrompt } from "@/components/InstallPrompt";

function NotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("notFound.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.desc")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("notFound.goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("error.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.desc")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("error.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("notFound.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "DropPocket — Tšekid, garantiid ja dokumendid ühes taskus" },
      { name: "description", content: "Sinu garantiitšekid, ostudokumendid ja lepingud – turvaliselt ühes kohas. Ära hoia tšekke enam sahtlis, kus need pleegivad või kaovad. Pildista, salvesta pilve" },
      { name: "author", content: "DropPocket" },
      { name: "theme-color", content: "#1d4ed8" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "DropPocket" },
      { name: "mobile-web-app-capable", content: "yes" },
      { property: "og:title", content: "DropPocket — Tšekid, garantiid ja dokumendid ühes taskus" },
      { property: "og:description", content: "Sinu garantiitšekid, ostudokumendid ja lepingud – turvaliselt ühes kohas. Ära hoia tšekke enam sahtlis, kus need pleegivad või kaovad. Pildista, salvesta pilve" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "DropPocket — Tšekid, garantiid ja dokumendid ühes taskus" },
      { name: "twitter:description", content: "Sinu garantiitšekid, ostudokumendid ja lepingud – turvaliselt ühes kohas. Ära hoia tšekke enam sahtlis, kus need pleegivad või kaovad. Pildista, salvesta pilve" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/07c32718-328a-4b1b-a20e-91c50dd19b8b/id-preview-2666df64--05f96460-0af4-4e48-856e-5d4948255403.lovable.app-1783518886918.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/07c32718-328a-4b1b-a20e-91c50dd19b8b/id-preview-2666df64--05f96460-0af4-4e48-856e-5d4948255403.lovable.app-1783518886918.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      { rel: "shortcut icon", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="et">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var m=window.matchMedia('(prefers-color-scheme: dark)');function s(){document.documentElement.classList.toggle('dark',m.matches);}s();m.addEventListener&&m.addEventListener('change',s);}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    registerPwa();
    // Auto sync .dark class with system preference so tokens (and dark logo) switch automatically.
    if (typeof window !== "undefined" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = (dark: boolean) => {
        document.documentElement.classList.toggle("dark", dark);
      };
      apply(mq.matches);
      const onChange = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener?.("change", onChange);
    }
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        void (async () => {
          const { data: u } = await supabase.auth.getUser();
          if (!u.user) return;
          const { data: p } = await supabase
            .from("profiles")
            .select("language")
            .eq("id", u.user.id)
            .maybeSingle();
          if (p?.language) await setLang(pickLang(p.language) as Lang);
        })();
      }
    });
    // On first mount, if a session exists, hydrate language from profile.
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("language")
        .eq("id", u.user.id)
        .maybeSingle();
      if (p?.language) await setLang(pickLang(p.language) as Lang);
    })();
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-right" richColors closeButton />
      <InstallPrompt />
    </QueryClientProvider>
  );
}
