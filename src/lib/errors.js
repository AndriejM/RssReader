import { t } from './i18n.js';

/**
 * Описать ошибку для интерфейса. Ошибки приходят из background/offscreen как помеченные
 * кодом данные `{ code, params, message }` (см. `rss.js`): код указывает на ключ
 * `errors.<code>`, а `params` заполняет его placeholders — так текст строится на языке
 * страницы. Строковые ошибки прошлых версий возвращаются как есть.
 */
export function describeError(error) {
  const source = error?.error ?? error;

  if (source?.code) {
    return t(`errors.${source.code}`, { message: source.message, ...source.params });
  }
  if (typeof source === 'string') return source;

  return source?.message ?? t('common.unknownError');
}
