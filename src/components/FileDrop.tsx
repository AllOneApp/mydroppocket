import { useRef, useState } from "react";
import { UploadCloud, FileText as FileIcon, X } from "lucide-react";
import { Button } from "./ui/button";

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
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => ref.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          drag ? "border-primary bg-accent/40" : "border-border hover:bg-muted/40"
        }`}
      >
        {file ? (
          <div className="flex w-full items-center gap-3">
            <FileIcon className="h-5 w-5 text-primary" />
            <div className="flex-1 truncate text-left text-sm">{file.name}</div>
            <Button type="button" variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onFile(null); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <UploadCloud className="mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">Drop a file or click to upload</p>
            <p className="text-xs text-muted-foreground">Photo, image or PDF</p>
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
          {scanning ? "Scanning with AI…" : "✨ Auto-fill from document"}
        </Button>
      )}
    </div>
  );
}