// PDF backup generation using pdf-lib. Server-only (Worker-safe).
// Renders a simple, readable A4 report for each MyDropPocket module.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type PdfLang = "et" | "en";

// WinAnsi (CP1252) covers Estonian ä ö õ ü š ž. Replace anything outside with
// a best-effort ASCII transliteration to keep pdf-lib from throwing.
const TRANSLIT: Record<string, string> = {
  ā: "a", ă: "a", ą: "a", ć: "c", č: "c", ď: "d", đ: "d",
  ē: "e", ĕ: "e", ė: "e", ę: "e", ě: "e", ĝ: "g", ğ: "g",
  ī: "i", ĭ: "i", į: "i", ı: "i", ĺ: "l", ľ: "l", ł: "l",
  ń: "n", ň: "n", ō: "o", ŏ: "o", ő: "o", ŕ: "r", ř: "r",
  ś: "s", ş: "s", ŝ: "s", ť: "t", ţ: "t", ū: "u", ŭ: "u",
  ů: "u", ű: "u", ų: "u", ŵ: "w", ŷ: "y", ź: "z", ż: "z",
  Ā: "A", Ă: "A", Ą: "A", Ć: "C", Č: "C", Ď: "D", Đ: "D",
  Ē: "E", Ė: "E", Ę: "E", Ě: "E", Ğ: "G", Ī: "I", Į: "I",
  Ł: "L", Ń: "N", Ň: "N", Ō: "O", Ő: "O", Ř: "R", Ś: "S",
  Ş: "S", Ť: "T", Ū: "U", Ů: "U", Ű: "U", Ų: "U", Ź: "Z", Ż: "Z",
  "\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'",
  "\u201C": '"', "\u201D": '"', "\u2026": "...",
};

const WINANSI_KEEP = new Set<number>();
// ASCII printable
for (let c = 0x20; c <= 0x7e; c++) WINANSI_KEEP.add(c);
// Latin-1 supplement + common CP1252 extras
for (let c = 0xa0; c <= 0xff; c++) WINANSI_KEEP.add(c);
// Estonian š/Š ž/Ž etc.
for (const c of [0x152, 0x153, 0x160, 0x161, 0x17d, 0x17e, 0x178]) WINANSI_KEEP.add(c);

function sanitize(s: string): string {
  let out = "";
  for (const ch of s) {
    if (TRANSLIT[ch]) { out += TRANSLIT[ch]; continue; }
    const code = ch.codePointAt(0)!;
    if (WINANSI_KEEP.has(code)) out += ch;
    else out += "?";
  }
  return out;
}

type Row = Record<string, unknown>;

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") { try { return JSON.stringify(v); } catch { return ""; } }
  return String(v);
}

// Very lightweight table renderer: paginates rows, wraps long cells (truncates).
export async function renderBackupPdf(opts: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Row[];
  summary?: Array<{ label: string; value: string | number }>;
  lang: PdfLang;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(sanitize(opts.title));
  pdf.setCreator("MyDropPocket");
  const font: PDFFont = await pdf.embedFont(StandardFonts.Helvetica);
  const bold: PDFFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 842; // A4 landscape
  const pageHeight = 595;
  const margin = 32;
  const bodySize = 8.5;
  const headerSize = 9;
  const usable = pageWidth - margin * 2;

  const cols = opts.columns;
  const colWidth = usable / Math.max(cols.length, 1);

  const generatedAt = new Date().toLocaleString(opts.lang === "et" ? "et-EE" : "en-GB");
  const genLabel = opts.lang === "et" ? "Loodud" : "Generated";

  let page: PDFPage = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeader = () => {
    page.drawText(sanitize(opts.title), { x: margin, y: y - 14, size: 16, font: bold, color: rgb(0.05, 0.1, 0.2) });
    y -= 22;
    if (opts.subtitle) {
      page.drawText(sanitize(opts.subtitle), { x: margin, y: y - 10, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
      y -= 14;
    }
    page.drawText(sanitize(`${genLabel}: ${generatedAt}`), { x: margin, y: y - 10, size: 8, font, color: rgb(0.45, 0.45, 0.5) });
    y -= 18;
    // column header row
    page.drawRectangle({ x: margin, y: y - 14, width: usable, height: 14, color: rgb(0.94, 0.95, 0.98) });
    cols.forEach((c, i) => {
      page.drawText(sanitize(truncate(c, colWidth - 6, bold, headerSize)), {
        x: margin + i * colWidth + 3,
        y: y - 11,
        size: headerSize,
        font: bold,
        color: rgb(0.1, 0.15, 0.25),
      });
    });
    y -= 16;
  };

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    drawHeader();
  };

  drawHeader();

  if (opts.rows.length === 0) {
    page.drawText(sanitize(opts.lang === "et" ? "Kirjeid ei ole." : "No entries."), {
      x: margin, y: y - 12, size: 10, font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 20;
  }

  for (const row of opts.rows) {
    if (y < margin + 40) newPage();
    const rowHeight = 12;
    cols.forEach((c, i) => {
      const raw = cell((row as Row)[c]);
      const txt = truncate(raw, colWidth - 6, font, bodySize);
      page.drawText(sanitize(txt), {
        x: margin + i * colWidth + 3,
        y: y - 9,
        size: bodySize,
        font,
        color: rgb(0.12, 0.12, 0.15),
      });
    });
    page.drawLine({
      start: { x: margin, y: y - rowHeight },
      end: { x: margin + usable, y: y - rowHeight },
      thickness: 0.3,
      color: rgb(0.88, 0.88, 0.9),
    });
    y -= rowHeight;
  }

  if (opts.summary && opts.summary.length > 0) {
    if (y < margin + 60) newPage();
    y -= 8;
    page.drawText(sanitize(opts.lang === "et" ? "Kokkuvõte" : "Summary"), {
      x: margin, y: y - 12, size: 11, font: bold, color: rgb(0.05, 0.1, 0.2),
    });
    y -= 18;
    for (const s of opts.summary) {
      if (y < margin + 20) newPage();
      page.drawText(sanitize(`${s.label}: ${s.value}`), {
        x: margin, y: y - 10, size: 9, font, color: rgb(0.15, 0.15, 0.2),
      });
      y -= 14;
    }
  }

  return await pdf.save();
}

function truncate(text: string, maxWidth: number, font: PDFFont, size: number): string {
  const clean = sanitize(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let lo = 0, hi = clean.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (font.widthOfTextAtSize(clean.slice(0, mid) + "…", size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return clean.slice(0, lo) + "…";
}