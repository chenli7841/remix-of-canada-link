import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { driverEnglish } from "./driver-translations";
export type DriverLanguage = "zh" | "en";
export function translateDriver(language: DriverLanguage, text: string, ...values: unknown[]) {
  if (!text.trim()) return text;
  const key = Object.prototype.hasOwnProperty.call(driverEnglish, text)
    ? text
    : Object.keys(driverEnglish).find((k) => driverEnglish[k] === text);
  const translated = language === "en" ? (key ? driverEnglish[key] : text) : (key ?? text);
  if (!key && !values.length) {
    for (const [zh, en] of Object.entries(driverEnglish)) {
      for (const pattern of [zh, en]) {
        if (!/\{\d+\}/.test(pattern)) continue;
        const indexes = [...pattern.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
        const parts = pattern.split(/\{\d+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const match = text.match(new RegExp("^" + parts.join("(.*?)") + "$"));
        if (match) {
          const args: unknown[] = [];
          indexes.forEach((n, i) => (args[n] = match[i + 1]));
          return translateDriver(language, zh, ...args);
        }
      }
    }
  }
  return translated.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
const DriverLanguageContext = createContext<{
  language: DriverLanguage;
  setLanguage: (value: DriverLanguage) => void;
}>({ language: "zh", setLanguage: () => {} });
export function DriverLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<DriverLanguage>("zh");
  useEffect(() => {
    try {
      if (localStorage.getItem("eplus-driver-language") === "en") setLanguageState("en");
    } catch {}
  }, []);
  const setLanguage = (value: DriverLanguage) => {
    setLanguageState(value);
    try {
      localStorage.setItem("eplus-driver-language", value);
    } catch {}
  };
  return (
    <DriverLanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </DriverLanguageContext.Provider>
  );
}
export function useDriverLanguage() {
  const { language, setLanguage } = useContext(DriverLanguageContext);
  const t = useCallback(
    (text: string, ...values: unknown[]) => translateDriver(language, text, ...values),
    [language],
  );
  return {
    language,
    setLanguage,
    t,
    date: (value: string) =>
      new Date(value).toLocaleString(language === "en" ? "en-CA" : "zh-CN", {
        timeZone: "America/Toronto",
      }),
    money: (value: unknown) => (value == null ? t("待确认") : `CA$${Number(value).toFixed(2)}`),
  };
}
export function DriverLanguageSwitch() {
  const { language, setLanguage } = useDriverLanguage();
  return (
    <div
      role="group"
      aria-label="语言 / Language"
      className="flex shrink-0 rounded-lg border border-slate-600 p-1"
    >
      {(["zh", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={language === value}
          onClick={() => setLanguage(value)}
          className={
            "min-h-11 rounded-md px-3 text-sm font-medium " +
            (language === value ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800")
          }
        >
          {value === "zh" ? "中文" : "English"}
        </button>
      ))}
    </div>
  );
}
