import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import et from "./locales/et.json";

export const SUPPORTED_LANGS = ["en", "et"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export function pickLang(input: string | null | undefined): Lang {
  if (!input) return "en";
  const l = input.toLowerCase();
  if (l === "et" || l.startsWith("et-")) return "et";
  return "en";
}

if (!i18n.isInitialized) {
  // Estonian is the default. Only saved user preference in localStorage overrides it.
  const initialLang: Lang =
    typeof window !== "undefined"
      ? (localStorage.getItem("dp_lang") === "en" ? "en" : "et")
      : "et";

  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        et: { translation: et },
      },
      lng: initialLang,
      fallbackLng: "et",
      supportedLngs: ["en", "et"],
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage"],
        lookupLocalStorage: "dp_lang",
        caches: ["localStorage"],
      },
    });
}

export async function setLang(lang: Lang) {
  await i18n.changeLanguage(lang);
  if (typeof window !== "undefined") localStorage.setItem("dp_lang", lang);
}

export default i18n;