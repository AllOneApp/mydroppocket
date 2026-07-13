import { useRef, useState } from "react";
import { UploadCloud, FileText as FileIcon, X } from "lucide-react";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";

export function FileDrop({
  file, onFile, onScan, scanning,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  onScan?: () => void;
  scanning?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => ref.current?.click()}
        className={`flex w-full min-w-0 max-w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          drag
            ? "border-primary bg-primary/15"
            : file
              ? "border-primary/60 bg-primary/5"
              : "border-primary bg-primary/10 hover:bg-primary/15 animate-pulse"
        }`}
      >
        {file ? (
          <div className="flex w-full min-w-0 items-center gap-3">
            <FileIcon className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 truncate text-left text-sm" title={file.name}>{file.name}</div>
            <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); onFile(null); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <UploadCloud className="mb-2 h-6 w-6 text-primary" />
            <p className="text-sm font-medium text-primary">{t("file.drop")}</p>
            <p className="text-xs text-primary/70">{t("file.types")}</p>
          </>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </div>
      {file && onScan && (
        <Button type="button" variant="outline" size="sm" onClick={onScan} disabled={scanning} className="mt-2 w-full">
          {scanning ? t("file.scanning") : t("file.autoFill")}
        </Button>
      )}
    </div>
  );
}