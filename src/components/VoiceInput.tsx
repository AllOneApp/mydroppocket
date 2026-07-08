import { Mic, Square, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";

import { Button } from "./ui/button";
import { transcribeAudio, parseVoiceCommand } from "@/lib/voice.functions";

type Context = "expense" | "income" | "expense_or_income" | "warranty" | "agreement" | "search" | "document";

type Props = {
  context: Context;
  onResult: (data: Record<string, string | number | null>, transcript: string) => void;
  size?: "sm" | "default" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
  label?: string;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function VoiceInput({ context, onResult, size = "sm", variant = "outline", className, label }: Props) {
  const { t, i18n } = useTranslation();
  const transcribe = useServerFn(transcribeAudio);
  const parse = useServerFn(parseVoiceCommand);
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => finish(rec.mimeType || "audio/webm");
      rec.start();
      recorderRef.current = rec;
      setState("recording");
    } catch (e) {
      toast.error(t("voice.micDenied"));
      console.error(e);
    }
  }

  function stop() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
  }

  async function finish(mimeType: string) {
    setState("processing");
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size < 1024) {
        toast.error(t("voice.tooShort"));
        setState("idle");
        return;
      }
      const base64 = await blobToBase64(blob);
      const stt = await transcribe({ data: { mime: mimeType, base64 } });
      if (!stt.ok) { toast.error(stt.error); setState("idle"); return; }
      if (!stt.text.trim()) { toast.error(t("voice.tooShort")); setState("idle"); return; }
      const parsed = await parse({ data: { text: stt.text, context, lang: i18n.language || "et" } });
      if (!parsed.ok) { toast.error(parsed.error); setState("idle"); return; }
      onResult(parsed.data, stt.text);
      toast.success(t("voice.filled"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setState("idle");
    }
  }

  const busy = state === "processing";
  const recording = state === "recording";
  const onClick = recording ? stop : start;
  const Icon = busy ? Loader2 : recording ? Square : Mic;
  const text = label ?? (recording ? t("voice.stop") : busy ? t("voice.processing") : t("voice.speak"));

  return (
    <Button
      type="button"
      size={size}
      variant={recording ? "destructive" : variant}
      onClick={onClick}
      disabled={busy}
      className={className}
      aria-label={text}
    >
      <Icon className={`h-4 w-4 ${busy ? "animate-spin" : ""} ${size !== "icon" ? "mr-1.5" : ""}`} />
      {size !== "icon" && <span>{text}</span>}
    </Button>
  );
}