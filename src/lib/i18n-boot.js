// Apply the remembered interface language before the page module resolves: the reader, the feeds
// screen and the settings screen share one origin, so the language cached in localStorage is
// already the right one, and a first run takes it from the browser language.
import { adoptLanguage, applyI18n, detectBrowserLanguage, getLanguageCache } from './i18n.js';

adoptLanguage(getLanguageCache() ?? detectBrowserLanguage());
applyI18n();
