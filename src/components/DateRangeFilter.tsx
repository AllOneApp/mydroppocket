import { useTranslation } from "react-i18next";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type DateRange = { from: string; to: string; preset: PresetKey };
export type PresetKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "thisYear" | "lastYear" | "all" | "custom";

function iso(d: Date) { return d.toISOString().slice(0, 10); }

export function computeRange(preset: PresetKey, from?: string, to?: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate();
  const dow = now.getDay(); // 0=Sun
  const monStart = new Date(y, m, d - ((dow + 6) % 7));
  switch (preset) {
    case "today": return { from: iso(new Date(y, m, d)), to: iso(new Date(y, m, d)) };
    case "yesterday": return { from: iso(new Date(y, m, d - 1)), to: iso(new Date(y, m, d - 1)) };
    case "thisWeek": return { from: iso(monStart), to: iso(new Date(y, m, d)) };
    case "lastWeek": {
      const lastEnd = new Date(monStart); lastEnd.setDate(lastEnd.getDate() - 1);
      const lastStart = new Date(lastEnd); lastStart.setDate(lastStart.getDate() - 6);
      return { from: iso(lastStart), to: iso(lastEnd) };
    }
    case "thisMonth": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m, d)) };
    case "lastMonth": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "thisYear": return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, m, d)) };
    case "lastYear": return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) };
    case "all": return { from: "1900-01-01", to: iso(new Date(y, m, d)) };
    case "custom": return { from: from ?? iso(new Date(y, m, 1)), to: to ?? iso(new Date(y, m, d)) };
  }
}

const PRESETS: PresetKey[] = ["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "thisYear", "lastYear", "all", "custom"];

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[10rem]">
        <Label className="text-xs">{t("dateRange.period")}</Label>
        <Select
          value={value.preset}
          onValueChange={(p) => {
            const preset = p as PresetKey;
            const r = computeRange(preset, value.from, value.to);
            onChange({ preset, from: r.from, to: r.to });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => <SelectItem key={p} value={p}>{t(`dateRange.presets.${p}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {value.preset === "custom" && (
        <>
          <div>
            <Label className="text-xs">{t("dateRange.from")}</Label>
            <Input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">{t("dateRange.to")}</Label>
            <Input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </div>
        </>
      )}
    </div>
  );
}