import { useRef, useState } from "react";
import { UploadCloud, FileText as FileIcon, X, Eye, Download } from "lucide-react";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";
import { signedUrl } from "@/lib/records";
import { toast } from "sonner";

export interface ExistingAttachment {
  id: string;
  name: string;
  filePath: string;
}

export interface MultiFileDropProps {
  existing: ExistingAttachment[];
  pending: File[];
  onAddFiles: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onRemoveExisting: (id: string) => void;
  /** Maximum total files (existing + pending). Defaults to 20. */
  maxFiles?: number;
  /** Optional label overrides (falls back to i18n keys under `agreements.*`). */
  labels?: {
    title?: string;
    add?: string;
    count?: string;
    empty?: string;
    hint?: string;
  };
  accept?: string;
  disabled?: boolean;
}

/**
 * Reusable multi-file / multi-image dropzone. Shows existing (already stored)
 * attachments and pending (not-yet-uploaded) files in one list. Enforces a
 * configurable max file count. Designed to be dropped into any module — the
 * caller owns storage/persistence.
 */
export function MultiFileDrop({
  existing,
  pending,
  onAddFiles,
  onRemovePending,
  onRemoveExisting,
  maxFiles = 20,
  labels,
  accept = "image/*,application/pdf",
  disabled,
}: MultiFileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const { t } = useTranslation();
  const total = existing.length + pending.length;
  const remaining = Math.max(0, maxFiles - total);
  const atMax = remaining === 0;

  const title = labels?.title ?? t("agreements.attachments", { defaultValue: "Attachments" });
  const addLabel = labels?.add ?? t("agreements.attachmentsAdd", { defaultValue: "Add files" });
  const countLabel =
    labels?.count ??
    t("agreements.attachmentsCount", {
      defaultValue: "{{count}} / {{max}} files added",
      count: total,
      max: maxFiles,
    });
  const emptyLabel = labels?.empty ?? t("agreements.attachmentsEmpty", { defaultValue: "No attachments added yet." });
  const hintLabel =
    labels?.hint ??
    t("agreements.attachmentsHint", {
      defaultValue: "Images and PDFs — up to {{max}} files.",
      max: maxFiles,
    });

  function pushFiles(list: FileList | File[] | null | undefined) {
    if (!list) return;
    const arr = Array.from(list);
    if (arr.length === 0) return;
    if (arr.length > remaining) {
      toast.error(t("agreements.attachmentsMaxReached", { defaultValue: "Maximum number of files is {{max}}.", max: maxFiles }));
      onAddFiles(arr.slice(0, remaining));
      return;
    }
    onAddFiles(arr);
  }

  async function openExisting(a: ExistingAttachment) {
    try {
      const url = await signedUrl(a.filePath);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }
  async function downloadExisting(a: ExistingAttachment) {
    try {
      const url = await signedUrl(a.filePath);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.name;
      link.click();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="w-full min-w-0 max-w-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{countLabel}</div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!atMax && !disabled) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (atMax || disabled) return;
          pushFiles(e.dataTransfer.files);
        }}
        onClick={() => { if (!atMax && !disabled) inputRef.current?.click(); }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          atMax || disabled
            ? "cursor-not-allowed border-muted bg-muted/30 text-muted-foreground"
            : drag
              ? "border-primary bg-primary/15"
              : "border-primary bg-primary/10 hover:bg-primary/15"
        }`}
      >
        <UploadCloud className="mb-2 h-6 w-6" />
        <p className="text-sm font-medium">➕ {addLabel}</p>
        <p className="text-xs opacity-80">{hintLabel}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => { pushFiles(e.target.files); if (inputRef.current) inputRef.current.value = ""; }}
        />
      </div>

      <div className="mt-3 space-y-2">
        {total === 0 && (
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        )}
        {existing.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <FileIcon className="h-4 w-4 shrink-0 text-primary" />
            <button type="button" onClick={() => openExisting(a)} className="min-w-0 flex-1 truncate text-left hover:text-primary" title={a.name}>{a.name}</button>
            <Button type="button" variant="ghost" size="icon" onClick={() => openExisting(a)} aria-label="view"><Eye className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => downloadExisting(a)} aria-label="download"><Download className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveExisting(a.id)} aria-label="remove"><X className="h-4 w-4" /></Button>
          </div>
        ))}
        {pending.map((f, i) => (
          <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-dashed bg-primary/5 px-3 py-2 text-sm">
            <FileIcon className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</div>
            <span className="shrink-0 text-xs text-muted-foreground">{Math.ceil(f.size / 1024)} KB</span>
            <Button type="button" variant="ghost" size="icon" onClick={() => onRemovePending(i)} aria-label="remove"><X className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}