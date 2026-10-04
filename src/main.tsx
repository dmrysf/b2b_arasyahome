import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveApiBaseUrl } from "./config";
import { initialLocale, MESSAGES } from "./i18n";
import { I18nProvider } from "./i18n/context";
import "./styles/app.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
try {
  const apiBaseUrl = resolveApiBaseUrl(import.meta.env.VITE_B2B_API_BASE_URL, __B2B_E2E_LOOPBACK_HOST__);
  root.render(<StrictMode><I18nProvider><App apiBaseUrl={apiBaseUrl} /></I18nProvider></StrictMode>);
} catch {
  const locale = initialLocale();
  document.documentElement.lang = locale;
  root.render(<div className="boot" role="alert"><span className="brand-mark" aria-hidden="true">A</span><p>{MESSAGES[locale].brand.notConfigured}</p></div>);
}
