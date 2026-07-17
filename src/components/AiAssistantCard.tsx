import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bot, Send, Loader2, ExternalLink, FileText, Cloud, ArrowRight, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VoiceInput } from "@/components/VoiceInput";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { askAssistant } from "@/lib/ai-assistant.functions";
import type { AssistantGroup, AssistantItem, AssistantIntent } from "@/lib/ai-assistant.server";
import { formatCurrency } from "@/lib/records";
import { formatDate } from "@/lib/format";
import { signedUrl } from "@/lib/records";

type ChatMsg = { role: "user" | "assistant"; content: string; groups?: AssistantGroup[]; suggestions?: string[] };

const INTENT_ICON: Record<AssistantIntent, string> = {
  warranties: "🛡️",
  expenses: "🧾",
  income: "💰",
  agreements: "📄",
  installments: "💳",
  recurring: "🔁",
};

export function AiAssistantCard() {
  const { t, i18n } = useTranslation();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const navigate = useNavigate();
  const ask = useServerFn(askAssistant);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset conversation when active profile changes — strict per-profile isolation.
  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [activeProfileId]);

  const locale: "et" | "en" = i18n.language.startsWith("en") ? "en" : "et";

  const mutation = useMutation({
    mutationFn: async (question: string) => {
      if (!activeProfileId) throw new Error("No active profile");
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await ask({ data: { question, profileId: activeProfileId, locale, history } });
      return res;
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.answer, groups: res.groups, suggestions: res.suggestions },
      ]);
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 50);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("common.failed")),
  });

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || mutation.isPending) return;
      setMessages((prev) => [...prev, { role: "user", content: q }]);
      setInput("");
      mutation.mutate(q);
    },
    [mutation],
  );

  const suggestions = useMemo(
    () => (locale === "et"
      ? [
          "Leia minu Puma tossude tšekk",
          "Kas Boschi trellil on garantii veel kehtiv?",
          "Näita kõik Euronicsi ostud",
          "Kui palju kulutasin eelmisel kuul autole?",
          "Näita kõik järelmaksud",
          "Mis garantiid lõppevad järgmise 30 päeva jooksul?",
        ]
      : [
          "Find my Puma shoes receipt",
          "Is my Bosch drill still under warranty?",
          "Show all Euronics purchases",
          "How much did I spend on the car last month?",
          "Show all installments",
          "Which warranties expire in the next 30 days?",
        ]),
    [locale],
  );

  const filteredSuggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 4);
  }, [input, suggestions]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="card-soft mb-6 p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{t("aiAssistant.title")}</p>
          <p className="text-lg font-semibold truncate">{t("aiAssistant.subtitle")}</p>
        </div>
        {activeProfile && (
          <span className="hidden sm:inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {activeProfile.name}
          </span>
        )}
      </div>

      {messages.length > 0 && (
        <div ref={listRef} className="mb-3 max-h-[420px] space-y-3 overflow-y-auto rounded-lg border border-border bg-background/40 p-3">
          {messages.map((m, idx) => (
            <MessageBubble key={idx} msg={m} onOpenFile={openFilePath} onNavigate={(to) => navigate({ to })} onSuggest={send} />
          ))}
          {mutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="animate-pulse">{t("aiAssistant.thinking")}</span>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <textarea
          ref={textRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={t("aiAssistant.placeholder")}
          className="w-full resize-none rounded-lg border border-border bg-background p-3 pr-24 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/30"
          disabled={!activeProfileId || mutation.isPending}
        />
        <div className="absolute right-2 top-2 flex items-center gap-1">
          <VoiceInput
            context="search"
            size="icon"
            variant="ghost"
            onResult={(_data, transcript) => {
              if (transcript) {
                setInput(transcript);
                send(transcript);
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            onClick={() => send(input)}
            disabled={!input.trim() || !activeProfileId || mutation.isPending}
            aria-label={t("aiAssistant.send")}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {filteredSuggestions.length > 0 && (
          <div className="absolute inset-x-0 top-full mt-1 z-10 rounded-lg border border-border bg-popover p-1 shadow-lg">
            {filteredSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  send(s);
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.slice(0, 3).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition hover:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{t("aiAssistant.privacy")}</span>
      </p>
    </div>
  );
}

async function openFilePath(filePath: string) {
  try {
    const url = await signedUrl(filePath);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Failed to open file");
  }
}

function MessageBubble({
  msg,
  onOpenFile,
  onNavigate,
  onSuggest,
}: {
  msg: ChatMsg;
  onOpenFile: (path: string) => void;
  onNavigate: (to: string) => void;
  onSuggest: (s: string) => void;
}) {
  const { t } = useTranslation();
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <p className="pt-1 text-sm">{msg.content}</p>
      </div>
      {msg.groups && msg.groups.length > 0 && (
        <div className="space-y-2 pl-9">
          {msg.groups.map((g) => (
            <div key={g.kind}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {INTENT_ICON[g.kind]} {t(`aiAssistant.groups.${g.kind}`, { defaultValue: g.kind })} · {g.count}
                {g.total != null && ` · ${formatCurrency(g.total, g.currency ?? "EUR")}`}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.items.slice(0, 6).map((item) => (
                  <ResultCard key={`${item.kind}-${item.id}`} item={item} onOpenFile={onOpenFile} onNavigate={onNavigate} />
                ))}
              </div>
              {g.count > 6 && (
                <button
                  type="button"
                  onClick={() => onNavigate(g.items[0]!.route)}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  {t("aiAssistant.viewAll")} ({g.count})
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {msg.suggestions && msg.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-9">
          {msg.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition hover:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  item,
  onOpenFile,
  onNavigate,
}: {
  item: AssistantItem;
  onOpenFile: (path: string) => void;
  onNavigate: (to: string) => void;
}) {
  const { t } = useTranslation();
  const meta = item.meta;
  const extra = meta.warranty_expiry
    ? t("aiAssistant.warrantyUntil", { date: formatDate(String(meta.warranty_expiry)) })
    : meta.end_date
      ? t("aiAssistant.endsOn", { date: formatDate(String(meta.end_date)) })
      : meta.next_due_date
        ? t("aiAssistant.nextDue", { date: formatDate(String(meta.next_due_date)) })
        : null;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {item.amount != null && (
          <p className="shrink-0 text-sm font-semibold">{formatCurrency(item.amount, item.currency ?? "EUR")}</p>
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {[item.subtitle, item.date ? formatDate(item.date) : null].filter(Boolean).join(" · ")}
      </p>
      {extra && <p className="mt-0.5 text-xs text-muted-foreground">{extra}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.filePath && (
          <button
            type="button"
            onClick={() => onOpenFile(item.filePath!)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            <FileText className="h-3 w-3" /> {t("aiAssistant.actions.open")}
          </button>
        )}
        {item.gdriveFileId && (
          <a
            href={`https://drive.google.com/file/d/${item.gdriveFileId}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            <Cloud className="h-3 w-3" /> {t("aiAssistant.actions.openDrive")}
          </a>
        )}
        <button
          type="button"
          onClick={() => onNavigate(item.route)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
        >
          <ArrowRight className="h-3 w-3" /> {t("aiAssistant.actions.openModule")}
        </button>
        {item.filePath && (
          <button
            type="button"
            onClick={async () => {
              const { signedUrl: s } = await import("@/lib/records");
              const url = await s(item.filePath!);
              if (navigator.share) {
                try {
                  await navigator.share({ url, title: item.title });
                } catch {
                  await navigator.clipboard.writeText(url);
                  toast.success(t("aiAssistant.actions.linkCopied"));
                }
              } else {
                await navigator.clipboard.writeText(url);
                toast.success(t("aiAssistant.actions.linkCopied"));
              }
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            <ExternalLink className="h-3 w-3" /> {t("aiAssistant.actions.share")}
          </button>
        )}
      </div>
    </div>
  );
}