import { Download, Eye, Trash2, Printer, Pencil } from "lucide-react";
import { Button } from "./ui/button";
import { signedUrl } from "@/lib/records";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function RecordActions({ filePath, fileName, onDelete, onEdit }: { filePath: string | null; fileName?: string | null; onDelete: () => void; onEdit?: () => void }) {
  const { t } = useTranslation();
  async function open(download = false) {
    if (!filePath) return;
    try {
      const url = await signedUrl(filePath);
      if (download) {
        const a = document.createElement("a");
        a.href = url; a.download = fileName ?? "document"; a.click();
      } else {
        window.open(url, "_blank", "noopener");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {filePath && <Button size="sm" variant="outline" onClick={() => open(false)}><Eye className="mr-1.5 h-3.5 w-3.5" />{t("common.view")}</Button>}
      {onEdit && <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="mr-1.5 h-3.5 w-3.5" />{t("common.edit")}</Button>}
      {filePath && <Button size="sm" variant="outline" onClick={() => open(true)}><Download className="mr-1.5 h-3.5 w-3.5" />{t("common.download")}</Button>}
      {filePath && <Button size="sm" variant="outline" onClick={() => open(false)}><Printer className="mr-1.5 h-3.5 w-3.5" />{t("common.print")}</Button>}
      <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive"><Trash2 className="mr-1.5 h-3.5 w-3.5" />{t("common.delete")}</Button>
    </div>
  );
}