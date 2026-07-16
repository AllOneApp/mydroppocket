import { useState } from "react";
import { Plus, Trash2, Pencil, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export type WarrantyItem = {
  id: string;
  product_name: string;
  store: string;
  warranty_months: number | "custom";
  custom_months: string;
  purchase_date: string;
  warranty_expiry: string;
  amount: string;
  selected: boolean;
  source: "ai" | "manual";
};

const WARRANTY_OPTIONS: number[] = [6, 12, 24, 36, 60];

export function computeExpiry(purchaseDate: string, months: number): string {
  if (!purchaseDate || !Number.isFinite(months) || months <= 0) return "";
  const [y, m, d] = purchaseDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

function makeItem(partial: Partial<WarrantyItem>, defaults: { store?: string; purchase_date?: string }): WarrantyItem {
  const months = partial.warranty_months ?? 24;
  const purchase_date = partial.purchase_date ?? defaults.purchase_date ?? "";
  const expiry =
    partial.warranty_expiry ||
    (typeof months === "number" ? computeExpiry(purchase_date, months) : "");
  return {
    id: partial.id ?? crypto.randomUUID(),
    product_name: partial.product_name ?? "",
    store: partial.store ?? defaults.store ?? "",
    warranty_months: months,
    custom_months: partial.custom_months ?? "",
    purchase_date,
    warranty_expiry: expiry,
    amount: partial.amount ?? "",
    selected: partial.selected ?? true,
    source: partial.source ?? "manual",
  };
}

export function WarrantyCandidatesBlock({
  items,
  onChange,
  defaultStore,
  defaultPurchaseDate,
}: {
  items: WarrantyItem[];
  onChange: (next: WarrantyItem[]) => void;
  defaultStore?: string;
  defaultPurchaseDate?: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function update(id: string, patch: Partial<WarrantyItem>) {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const merged = { ...it, ...patch };
        // Recompute expiry when purchase date or preset months changes
        if ("purchase_date" in patch || "warranty_months" in patch) {
          if (typeof merged.warranty_months === "number") {
            merged.warranty_expiry = computeExpiry(merged.purchase_date, merged.warranty_months);
          }
        }
        if ("custom_months" in patch && merged.warranty_months === "custom") {
          const n = Number(patch.custom_months);
          if (Number.isFinite(n) && n > 0) merged.warranty_expiry = computeExpiry(merged.purchase_date, n);
        }
        return merged;
      }),
    );
  }

  function remove(id: string) {
    onChange(items.filter((it) => it.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  function addManual() {
    const it = makeItem({ source: "manual", selected: true }, { store: defaultStore, purchase_date: defaultPurchaseDate });
    onChange([...items, it]);
    setExpandedId(it.id);
  }

  const aiItems = items.filter((it) => it.source === "ai");

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">🛡️ Võimalikud garantiiga tooted</div>
        {aiItems.length > 0 && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI soovitas {aiItems.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          AI ei tuvastanud tšekilt garantiiga tooteid. Lisa käsitsi kui vaja.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const isExpanded = expandedId === it.id;
            return (
              <li key={it.id} className="rounded-md border border-border bg-background p-2">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={it.selected}
                    onCheckedChange={(v) => update(it.id, { selected: !!v })}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{it.product_name || <em className="text-muted-foreground">Nimetu toode</em>}</span>
                      {it.source === "ai" && (
                        <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5">🤖 AI</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {it.store || "—"} · {typeof it.warranty_months === "number" ? `${it.warranty_months} kuud` : `${it.custom_months || "?"} kuud`}
                      {it.warranty_expiry ? ` · kuni ${it.warranty_expiry}` : ""}
                    </div>
                    {it.source === "ai" && it.selected && !isExpanded && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                        🤖 AI tuvastas selle garantiiga tootena. Palun kontrolli andmed enne salvestamist.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => setExpandedId(isExpanded ? null : it.id)}
                      aria-label="Muuda"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive"
                      onClick={() => remove(it.id)}
                      aria-label="Eemalda"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Toote nimi</Label>
                      <Input
                        value={it.product_name}
                        onChange={(e) => update(it.id, { product_name: e.target.value })}
                        placeholder="Nt. Samsung Galaxy S26 Ultra"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Poe nimi</Label>
                      <Input
                        value={it.store}
                        onChange={(e) => update(it.id, { store: e.target.value })}
                        placeholder="Nt. Euronics"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Garantii pikkus</Label>
                      <Select
                        value={String(it.warranty_months)}
                        onValueChange={(v) => update(it.id, { warranty_months: v === "custom" ? "custom" : Number(v) })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WARRANTY_OPTIONS.map((m) => (
                            <SelectItem key={m} value={String(m)}>{m} kuud</SelectItem>
                          ))}
                          <SelectItem value="custom">Muu…</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {it.warranty_months === "custom" && (
                      <div>
                        <Label className="text-xs">Kuude arv</Label>
                        <Input
                          type="number"
                          min={1}
                          value={it.custom_months}
                          onChange={(e) => update(it.id, { custom_months: e.target.value })}
                        />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">Ostukuupäev</Label>
                      <Input
                        type="date"
                        value={it.purchase_date}
                        onChange={(e) => update(it.id, { purchase_date: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Garantii lõppkuupäev</Label>
                      <Input
                        type="date"
                        value={it.warranty_expiry}
                        onChange={(e) => update(it.id, { warranty_expiry: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Summa (valikuline)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={it.amount}
                        onChange={(e) => update(it.id, { amount: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addManual}
        className="w-full h-9"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Lisa garantiiga toode käsitsi
      </Button>
    </div>
  );
}

export function makeWarrantyItem(
  partial: Partial<WarrantyItem>,
  defaults: { store?: string; purchase_date?: string },
): WarrantyItem {
  return makeItem(partial, defaults);
}