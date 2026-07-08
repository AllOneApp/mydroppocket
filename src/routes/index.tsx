import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Wallet, FileText, ArrowRight, Sparkles, Lock, Search } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo className="h-10" />
        <div className="flex items-center gap-2">
          <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/auth"><Button className="brand-gradient-bg text-primary-foreground">Get started</Button></Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="pt-14 pb-24 text-center sm:pt-24">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> AI-powered receipt scanning
          </div>
          <h1 className="mx-auto max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl">
            Your receipts, warranties &amp; documents — <span className="bg-gradient-to-br from-primary to-blue-800 bg-clip-text text-transparent">safely in one pocket</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Snap a photo, drop a PDF, and DropPocket organises it for you. Never lose an important receipt again.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="brand-gradient-bg text-primary-foreground shadow-lg">
                Start free <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="#features"><Button size="lg" variant="outline">Learn more</Button></a>
          </div>
        </section>

        <section id="features" className="grid gap-6 pb-24 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: "Warranties", desc: "Track active warranties, get alerts before they expire." },
            { icon: Wallet, title: "Expenses", desc: "Log daily spending with or without a receipt." },
            { icon: FileText, title: "Agreements", desc: "Store contracts and installment plans safely." },
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
            <h3 className="text-lg font-semibold">Original files, never touched</h3>
            <p className="mt-2 text-sm text-muted-foreground">Every upload is preserved bit-for-bit — the original is always the original.</p>
          </div>
          <div className="card-soft p-6">
            <Search className="mb-3 h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">One search across everything</h3>
            <p className="mt-2 text-sm text-muted-foreground">Find a store, product, company or amount in a single field.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} DropPocket
      </footer>
    </div>
  );
}
