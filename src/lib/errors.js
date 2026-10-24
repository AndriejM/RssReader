import { t } from './i18n.js';

/**
 * Describe an error for the interface. Errors arrive from background/offscreen as code-tagged
 * data `{ code, params, message }` (see `rss.js`): the code points at the `errors.<code>` key,
 * and `params` fills its placeholders — so the text is built in the language of the page.
 * String errors from past versions are returned as they are.
 */
export function describeError(error) {
  const source = error?.error ?? error;

  if (source?.code) {
    return t(`errors.${source.code}`, { message: source.message, ...source.params });
  }
  if (typeof source === 'string') return source;

  return source?.message ?? t('common.unknownError');
}
