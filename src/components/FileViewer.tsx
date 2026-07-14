import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { signedUrl } from "@/lib/records";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export interface FileViewerFile {
  name: string;
  filePath: string;
  mime?: string | null;
}

/**
 * In-app viewer for images and PDFs stored in the `documents` bucket.
 * Reusable across every module — the caller supplies a signed-URL-backed file.
 * Falls back gracefully for unknown mime types.
 */
export function FileViewer({
  file,
  open,
  onOpenChange,
}: {
  file: FileViewerFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!open || !file) { setUrl(null); return; }
    setLoading(true);
    signedUrl(file.filePath)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch((e) => { if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, file]);

  function inferKind(): "image" | "pdf" | "other" {
    const mime = (file?.mime || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime === "application/pdf") return "pdf";
    const ext = (file?.name || file?.filePath || "").split(".").pop()?.toLowerCase();
    if (ext && ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    return "other";
  }

  async function download() {
    if (!file) return;
    try {
      const u = url ?? (await signedUrl(file.filePath));
      const a = document.createElement("a");
      a.href = u; a.download = file.name; a.click();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  const kind = inferKind();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-8 text-base">{file?.name ?? ""}</DialogTitle>
        </DialogHeader>

        <div className="relative flex-1 overflow-auto rounded-lg border bg-muted/30">
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {url && kind === "image" && (
            <div className="flex min-h-full items-center justify-center p-3">
              <img src={url} alt={file?.name ?? ""} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {url && kind === "pdf" && (
            <iframe src={url} title={file?.name ?? "PDF"} className="h-full w-full" />
          )}
          {url && kind === "other" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("file.previewUnavailable", { defaultValue: "Eelvaade pole selle failitüübi jaoks saadaval." })}
              </p>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline"><ExternalLink className="mr-1.5 h-4 w-4" />{t("common.openInNewTab", { defaultValue: "Ava uues aknas" })}</Button>
              </a>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />{t("common.openInNewTab", { defaultValue: "Ava uues aknas" })}</Button>
            </a>
          )}
          <Button variant="outline" size="sm" onClick={download}><Download className="mr-1.5 h-3.5 w-3.5" />{t("common.download")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}