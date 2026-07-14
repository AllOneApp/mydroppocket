import { type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Eye, Pencil, Trash2, FileText as FileIcon, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { FileViewer, type FileViewerFile } from "./FileViewer";

export interface DetailField {
  label: string;
  value: ReactNode;
  full?: boolean;
}

export interface DetailAttachment {
  id: string;
  name: string;
  filePath: string;
  mime?: string | null;
}

export interface RecordDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  fields: DetailField[];
  attachments: DetailAttachment[];
  onEdit?: () => void;
  onDelete?: () => void;
  /** Additional custom sections (Timeline, Payment schedule, etc.) rendered under attachments. */
  extraSections?: ReactNode;
}

/**
 * Reusable record detail modal. Structured info + attachment list with in-app
 * viewer + action buttons. Extra sections slot in below attachments — used by
 * future stages (Timeline, Payment schedule, Reminders, History) without
 * changing this component.
 */
export function RecordDetailView({
  open,
  onOpenChange,
  title,
  subtitle,
  fields,
  attachments,
  onEdit,
  onDelete,
  extraSections,
}: RecordDetailViewProps) {
  const { t } = useTranslation();
  const [viewingFile, setViewingFile] = useState<FileViewerFile | null>(null);

  function isImage(a: DetailAttachment) {
    const mime = (a.mime || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    const ext = (a.name || a.filePath).split(".").pop()?.toLowerCase();
    return !!ext && ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="break-words pr-8 text-xl leading-tight">{title}</DialogTitle>
            {subtitle && <p className="break-words text-sm text-muted-foreground">{subtitle}</p>}
          </DialogHeader>

          <div className="mt-4 space-y-6">
            {/* Info grid */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {fields.map((f, i) => (
                <div key={i} className={`min-w-0 ${f.full ? "sm:col-span-2" : ""}`}>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</div>
                  <div className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere]">{f.value ?? "—"}</div>
                </div>
              ))}
            </div>

            {/* Attachments */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">
                {t("common.attachedDocuments", { defaultValue: "Lisatud dokumendid" })}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({attachments.length})
                </span>
              </h3>
              {attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("common.noAttachments", { defaultValue: "Lisatud faile pole." })}
                </p>
              ) : (
                <ul className="space-y-2">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex w-full min-w-0 items-center gap-2 rounded-lg border bg-card px-2 py-2 sm:px-3">
                      {isImage(a)
                        ? <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
                        : <FileIcon className="h-4 w-4 shrink-0 text-primary" />}
                      <button
                        type="button"
                        onClick={() => setViewingFile({ name: a.name, filePath: a.filePath, mime: a.mime ?? null })}
                        className="min-w-0 flex-1 truncate text-left text-sm hover:text-primary"
                        title={a.name}
                      >
                        {a.name}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setViewingFile({ name: a.name, filePath: a.filePath, mime: a.mime ?? null })}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        {t("common.open", { defaultValue: "Ava" })}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {extraSections}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {onEdit && (
              <Button variant="outline" onClick={onEdit}>
                <Pencil className="mr-1.5 h-4 w-4" />{t("common.edit")}
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive">
                <Trash2 className="mr-1.5 h-4 w-4" />{t("common.delete")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <FileViewer
        file={viewingFile}
        open={!!viewingFile}
        onOpenChange={(o) => { if (!o) setViewingFile(null); }}
      />
    </>
  );
}

/**
 * Reusable View / Edit / Delete action row for record cards.
 */
export function RecordActionRow({
  onView,
  onEdit,
  onDelete,
}: {
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={onView}>
        <Eye className="mr-1.5 h-3.5 w-3.5" />{t("common.view")}
      </Button>
      <Button size="sm" variant="outline" onClick={onEdit}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" />{t("common.edit")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive">
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />{t("common.delete")}
      </Button>
    </div>
  );
}