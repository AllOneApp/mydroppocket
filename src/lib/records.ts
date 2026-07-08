import { supabase } from "@/integrations/supabase/client";

export type RecordKind = "warranty" | "expense" | "agreement";
export const tableFor: Record<RecordKind, "warranties" | "expenses" | "agreements"> = {
  warranty: "warranties",
  expense: "expenses",
  agreement: "agreements",
};

export async function uploadFile(userId: string, kind: RecordKind, file: File) {
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${userId}/${kind}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return { path, name: file.name, mime: file.type };
}

export async function signedUrl(path: string) {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteFile(path: string) {
  await supabase.storage.from("documents").remove([path]);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.split(",")[1] ?? "");
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function warrantyStatus(expiry: string | null): { label: string; tone: "green" | "orange" | "red" | "muted"; days: number | null } {
  if (!expiry) return { label: "No expiry", tone: "muted", days: null };
  const d = new Date(expiry);
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (diff < 0) return { label: `Expired ${-diff}d ago`, tone: "red", days: diff };
  if (diff <= 30) return { label: `${diff}d left`, tone: "orange", days: diff };
  return { label: `${diff}d left`, tone: "green", days: diff };
}

export function formatCurrency(amount: number | null | undefined, currency = "EUR") {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}