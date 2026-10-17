# RSS Reader — a Chrome extension

[Русская версия: README.ru.md](README.ru.md)

**Repository:** <https://github.com/AndriejM/RssReader>

Reading RSS news: a feed settings screen, a global settings screen, a three-panel reading
interface, automatic headline loading on a schedule and their automatic cleanup once their
storage time expires.

The extension has no third-party dependencies and requires no build: after the folder is loaded
all features work, and the network is needed only to read the feeds and articles themselves.

## Requirements

- **Chrome 109 or newer.** The `chrome.offscreen` API is required — it is needed to play sound:
  a service worker has no DOM, so an offscreen document is created for the signal file.
  (The fallback path `chrome.runtime.getContexts` appeared in Chrome 116.)
- MV3 (`manifest_version: 3`) — supported by all current Chrome/Edge.
- `node` (for `scripts/*.mjs`) — only for the unit tests and regenerating icons; the extension
  itself does not need node.

## Installation

1. `chrome://extensions` → enable “Developer mode”.
2. “Load unpacked extension” → select the project folder (`rss-reader-2`).
3. Chrome will ask for “Read and change all your data on all websites” and “Read your browsing
   history” permissions. The first is needed to read feed XML and article HTML via `<all_urls>`
   (see `host_permissions` in `manifest.json`). The second (`permissions: tabs`) is needed for
   exactly one thing — finding the extension's own reader tab so it does not open a second one;
   access to tab URLs is already granted by `<all_urls>` anyway.
4. The RSS Reader icon appears in the toolbar. Clicking it opens the reader in a new tab, and
   if the reader is already open — Chrome switches to that tab (the `action` has no
   `default_popup`, so a click always leads to the reader).
5. The global settings screen: the **“Global settings”** icon in the top-right corner of the
   reader — it opens the settings in the same tab — or
   `chrome://extensions` → RSS Reader → “Details” → “Extension details” → “Extension options”
   (and directly `chrome-extension://<id>/src/settings.html`). The “Extensions: details” button
   in `chrome://extensions` now leads to this very screen.
6. The feed settings screen: the **“Feed settings”** icon in the top-right corner (and directly
   `chrome-extension://<id>/src/feeds.html`). Both settings screens open in the same tab and
   return to the reader through the same row of icons.

## Screen switcher

All three screens carry the same row of icons in the top-right corner: **Reader**, **Feed
settings**, **Global settings**, and after them the theme toggle. The order is identical
everywhere, so the strip does not shift when you move between screens; the icon of the screen you
are on is highlighted and is not clickable.

Every icon has both a tooltip (`title`) and an `aria-label`, taken from the same dictionary key
(`nav.reader`, `nav.feeds`, `nav.global`), so the tooltip follows the interface language. The row
is built by `src/lib/nav.js`: a screen only says which screen it is (`data-nav-active` on its
`<nav>`) and keeps its own buttons outside the strip.

## Quick start

1. Open “Feed settings” (the icon in the top-right corner) → the “add feed” icon above the table.
2. Fill in the row: the feed name, the link, the headline fetch period and the news storage time →
   the “save” icon at the end of the same row (in storage these are `name`, `rss_link`,
   `delay_timeout`, `clean_timeout`).
   The feed is re-read once right away, so headlines appear immediately without waiting for the
   first alarm to fire.
3. Open the reader (click the toolbar icon or the reader icon in the top-right corner) → the
   first feed and its freshest headline are already selected, the article text is in the right
   panel; afterwards, clicking a feed on
   the left or a headline in the middle panel switches the panels.
4. From then on the feed is polled automatically every `delay_timeout` minutes; new headlines
   are marked with a badge on the icon and a short sound.

## Feed settings screen (`src/feeds.html`)

The feeds stand in a table: one row per feed, the columns named in plain words, while the fields
are exactly the ones from the assignment:

| Column | Field | Meaning | Units | Default | Constraints |
|---|---|---|---|---|---|
| Feed name | `name` | feed name | — | — | 1–120 characters |
| Link | `rss_link` | link to read the news from | — | — | must start with `http://` or `https://` |
| Headline fetch period | `delay_timeout` | period of automatic headline loading | minutes | 30 | at least 1 (Chrome does not allow alarms with a period under a minute) |
| News storage time | `clean_timeout` | how long a news item stays in storage after loading | minutes | 1440 (1 day) | at least 1 |

Next to the number of minutes the same term is shown in human units (“1.5 h”, “1 d”); it updates
while you type.

Icons above the table and at the end of a row:

- **“Add feed” (the “+” icon above the table)** — a new empty row: it is marked as a draft and
  lives in the same table until it is saved.
- **“Save”** — validates the fields and saves the feed. Errors are shown under the specific field;
  an invalid feed cannot be saved. In a new row the same icon adds the feed, and the delete icon
  cancels the draft.
- **“Load now”** — reads the feed once off the schedule (no sound at that moment) and shows
  “New: N, read: M”.
- **“Delete”** — deletes the feed together with its headlines (with a confirmation).
- Every icon has both a tooltip and an `aria-label`, so its action is clear without a caption
  under the column.

A message about the whole row (“Saved”, “Check the fields”, what a load returned) takes its own
line under it, and the screen’s explanation of the fields is folded behind the “?” icon in the
upper right of the table.

Screen header: the row of screen-switcher icons (here its “Feed settings” icon is the highlighted
one) and the theme toggle.

## Reading screen (`src/index.html`)

Three vertical panels:

1. **Feeds** — a list of feeds with their headline counts and update periods. The refresh icon
   at the top of the panel re-reads the selected feed once (no sound at that moment), and spins
   while loading.
2. **Headlines** — headlines of the selected feed from storage, freshest on top, with a
   “loaded N min ago” label and a storage time counted down from `clean_timeout`.
3. **Content** — the article text loaded at the moment of the click. The article headline in the
   right panel is itself a link to the original (new tab); in the corner above the text there is
   a delete icon: it removes the headline from the list and from storage, immediately opens the
   next headline of the same feed, and remembers the deleted one as read — on the next feed load
   it will no longer appear.

In the head of every panel there is its own font size switcher: four buttons drawn as the letter “A”,
each at the size it stands for. A button scales only the column it sits in — the feed list, the
headline list and the article text are sized independently, so the middle column stays compact while
the article is read at a large size. The size of a column is written to storage as soon as it is
chosen (`settings.font_scales`) and is applied again when the reader opens; two reader tabs keep the
same sizes, and a size chosen in one tab repaints the other without a reload.

When the reader opens, no cursor is left empty: the first feed in the list is selected, the
middle panel has its first (freshest) headline, and its text is shown in the right panel right
away. There is exactly one case of opting out of auto-selection: returning from a settings
screen in the same tab restores precisely the feed and precisely the headline you were on
(more on this below).

At the top of the reader there is a counter: the total number of headlines of all feeds in
storage. Next to it a trash-icon button (“Delete all”) — one click removes all headlines from
storage (the feeds themselves remain); in the top-right corner sit the screen-switcher icons and
the theme toggle (the reader icon is the highlighted one). The counters update when the background
downloads or cleans up headlines, so an open reader never shows stale data.

The “Feed settings” icon opens the settings in the same tab — no second tab appears — and the
reader icon on a settings screen returns the same way: to the same feed and the same
open headline. The “Global settings” icon (the last of the three, before the theme toggle) opens
the global settings screen the same way.

## Global settings screen (`src/settings.html`)

Settings that apply to the reader as a whole rather than to a single feed. It opens via the
“Global settings” icon in the top-right corner of any screen, and also via the “Extensions:
details” button in
`chrome://extensions` (`options_ui` in the manifest). Fields:

| Field | Meaning | Units | Default | Constraints |
|---|---|---|---|---|
| `read_ttl_days` | how many days to forget read items: the period that keeps a deleted news item from coming back from the feed | days | 7 | integer from 1 to 3650 |
| sound on download | combobox: which mp3 from `src/media` to play when an automatic load brings headlines; the first row “No sound” turns the signal off | — | `ceres.mp3` | only files from `src/media` or “No sound” |
| interface language | combobox: which language the labels, tooltips and messages of all screens use (“Русский”, “English”, “Українська”, “Polski”, “Deutsch”, “Français”, “Español”) | — | the browser language; if it is not among the supported ones — `English` | only languages from `src/lib/i18n.js` |

The fields themselves write nothing to storage: the period, the signal and the language go there
only via the **“Write”** button. While a field's value differs from what is stored, the button is
active and “Changes not saved” appears at the bottom of the card; after saving, the same spot
shows “Saved: marks burn out in M days · sound: <file> · language: <language>”. Below the field
are the value currently in storage and the number of marks it holds (“read marks: N · burn out
in M days”). Next to the field is the **“Forget read items”** button (with a confirmation): one
press clears the entire `read` list without waiting for `read_ttl_days` to expire, so news items
you deleted earlier may come back on the next feed load.

All three values live under the `settings` key in `chrome.storage.local` — in the same place as
the theme. The service worker reads them: the period — when it purges read items, so a horizon
saved via “Write” immediately wakes up the cleanup and applies to automatic loading;
`sound_file` — to decide which file plays after that same load (or plays nothing at all if
“No sound” is selected).

The interface language is taken by the pages: `settings.language`, and if there is no stored
value (first launch) — the browser language (`navigator.language` and `navigator.languages`),
and only if it is not supported by the extension — `English`. A saved language takes effect
right away: the screen where it was changed re-pastes its own labels without a reload, and the
reader and the feed screen pick up the change via `chrome.storage.onChanged`.

Screen header: the row of screen-switcher icons (here its “Global settings” icon is the
highlighted one; the reader icon returns to the reader in this same tab, keeping the selected feed
and headline) and the theme toggle.

## Structure

```
manifest.json                 MV3, permissions: storage, unlimitedStorage, alarms, offscreen,
                              tabs
icons/                        RSS icon (16/32/48/128), generated by a script
src/background.js             service worker: feed polling, cleanup, badge, sound, icon click
src/index.html|js             three-panel reader (feeds → headlines → content)
src/feeds.html|js             feed configuration screen: add / edit / delete
src/settings.html|js          global settings screen: lifetime of the read list, its manual
                              cleanup, combobox of the signal file (“No sound” / mp3 from media)
                              and combobox of the interface language
src/lib/i18n.js              every label, message and tooltip: the `ru`, `en`, `uk`, `pl`,
                              `de`, `fr` and `es` dictionaries, `t(key, params)`,
                              `applyI18n()`, units, browser language
src/lib/i18n-boot.js         apply the stored language before the page is drawn by its module
src/lib/errors.js             turn a feed error (`{code, params}`) into text in the page's language
src/offscreen.html|js         offscreen document: the extension's only context with a DOM — feed
                              XML is parsed and sound is played here
src/lib/messages.js           message names between pages and the service worker
src/lib/storage.js            feeds, headlines, read list, settings, automatic cleanup
src/lib/alarms.js             an alarm per feed + a periodic-cleanup alarm
src/lib/offscreen.js          creating the offscreen document and exchanging messages with it
src/lib/rss.js                loading and parsing RSS 2.0 / Atom / RDF (runs inside the
                              offscreen document)
src/lib/encoding.js           response bytes → text: find the feed's encoding (BOM, `Content-Type`,
                              the XML declaration) and decode it with it (covered by tests)
src/lib/extract.js            article text extraction on a headline click
src/lib/sound.js              which signal file to play (reads the choice from the settings screen)
src/media/                    signal audio files: the one selected on the settings screen plays
                              (“No sound” turns the signal off)
src/lib/theme.js              light/dark theme
src/lib/fontsize.js           the size switcher in the head of a reader column: every column is sized
                              on its own, its size is written to the settings
src/font-boot.js              paint the remembered sizes before the page is drawn by its module
src/lib/nav.js                the row of screen-switcher icons: the same one on all three screens,
                              its tooltips taken from the dictionary (`nav.*`)
src/lib/tabs.js               one extension screen — one tab: find the open tab and activate it
                              instead of opening a second one
src/lib/util.js               pure functions without chrome.* (covered by tests)
_locales/                     the extension's own name and description in each of the seven
                              locales (en|ru|uk|pl|de|fr|es) — Chrome picks them by the browser
                              language (`__MSG_extensionName__` in the manifest)
src/styles/                   theme.css (theme CSS variables), reader.css, feeds.css, settings.css
scripts/test.mjs              unit tests of the pure functions: node scripts/test.mjs
scripts/make_icons.mjs        regenerate the icons without dependencies
scripts/check_icons.mjs       verify the result of make_icons.mjs
example_rss.xml               a sample feed; neither the reader code nor the tests reference it
nnm_example_rss_item.xml      a sample feed in Windows-1251: the decoding tests rely on it
```

## How the requirements are met

| # | Requirement | Where it is implemented |
|---|---|---|
| 1 | Configuration screen with a feed list, add/edit/delete; a feed has `rss_link`, `name`, `delay_timeout`, `clean_timeout`. Headlines are stored with a link to the feed, the headline, the http link to the news and the loading time | `src/feeds.html`, `src/feeds.js`, `util.normalizeFeed`, `store.makeItem` |
| 2 | Three vertical panels: feeds → headlines from storage → content; the content is fetched dynamically on a click; above it a delete button (from the list and from storage), the link to the original is in the article headline itself | `src/index.html`, `src/index.js`, `src/lib/extract.js`, `store.removeItem` |
| 3 | Clicking the icon opens the reading screen in a new tab, and if it is already open — the existing tab is activated rather than a new one created | `chrome.action.onClicked` in `src/background.js` → `tabs.focusOrCreateTab` (no `default_popup` in the manifest) |
| 4 | Automatic headline deletion once `clean_timeout` expires | `store.cleanup` + `CLEANUP_ALARM_NAME` in `src/lib/alarms.js` (checked once a minute), plus `store.cleanup()` when the reader opens |
| 5 | Light/dark theme toggle | `src/lib/theme.js`, `src/styles/theme.css`; the value is in `chrome.storage.local`, so it is synchronous across all pages |
| 6 | Badge on the icon: `1…99` as a number, `*` when over 99, empty at 0 | `util.badgeText` + `chrome.action.setBadgeText` + `chrome.action.setBadgeBackgroundColor` in `src/background.js`; the badge background is yellow and theme-dependent, so the number is readable in both Chrome toolbar themes |
| 7 | Sound when an automatic load brings more than 0 headlines | `store.addItems` returns the number of new items → `sound.playSound` reads the file selected on the settings screen → the offscreen document plays it (`playSound` does nothing when “No sound” is selected); manual “Refresh”/“Load now” produce no sound |
| 8 | A separate global settings screen (the same icon in the top-right corner of all three screens, the last of the three, before the theme toggle): `read_ttl_days` — how many days to forget read items, and a signal-file combobox (both saved via the “Write” button), plus a button that fully clears the read list | `src/settings.html`, `src/settings.js`, `store.getReadTtlDays` / `store.setReadTtlDays` / `store.setSoundChoice` / `store.clearRead` |
| 9 | Labels, messages and tooltips are factored into one configuration, from which the English one is derived; on the global settings screen a language combobox that is saved to storage; on load the reader takes the saved language, otherwise the browser language, otherwise English | `src/lib/i18n.js` (`ru` / `en` / `uk` / `pl` / `de` / `fr` / `es` dictionaries), `store.getLanguage` / `store.setLanguage`, `src/lib/i18n-boot.js`, `src/lib/errors.js`, `language-file` combobox in `src/settings.html` |

## Data schema

The “localstorage” from the assignment is `chrome.storage.local`, not `window.localStorage`: it
is the only store accessible simultaneously to both the service worker and both extension pages.
Four keys:

**`feeds`** — an array of feeds:

```json
{
  "id": "c0f4…",              // uuid (util.newId), assigned on first save
  "name": "Хабр",
  "rss_link": "https://habr.com/ru/rss/all/all/",
  "delay_timeout": 30,        // minutes
  "clean_timeout": 1440       // minutes
}
```

**`items`** — an array of headlines. The fields from the assignment are `rss_link`, `title`,
`link`, `time`; `uid`/`feedId`/`feedName` were added internally: to identify a headline and avoid
duplicates.

```json
{
  "uid": "<feedId>|<link>",   // unique key of the headline
  "feedId": "c0f4…",
  "feedName": "Хабр",
  "rss_link": "https://habr.com/ru/rss/all/all/",  // link to the feed
  "title": "Заголовок новости",
  "link": "https://habr.com/ru/news/…/",            // http link to the news
  "time": 1760000000000                             // headline loading time, ms
}
```

**`read`** — an array of read (user-deleted) news items. The feed server does not remove its own
headlines, so without this list a deleted news item would return on every next load. The record
key is the news `link`: a server may rewrite a headline but rarely changes the link, so a mark
survives both a feed edit and re-adding the feed.

```json
{
  "link": "https://habr.com/ru/news/…/",              // the news identifier it is matched by
  "pubDate": "Tue, 01 Oct 2024 08:00:00 GMT",        // the list is cleaned by this field's age
  "time": 1760000000000                              // deletion moment, if pubDate is absent
}
```

**`settings`** — `{ "theme": "dark" | "light", "sound": true | false, "read_ttl_days": 7, "sound_file": "src/media/ceres.mp3" | "none", "language": "ru", "font_scales": { "feeds": 1, "headlines": 1.2, "content": 1 } }`. `font_scales` is the font size of every reader column: a multiplier from the ladder `0.85 / 1 / 1.2 / 1.45` (`store.FONT_SCALES`), chosen by the switcher in the head of that column.

Other storage properties:

- The order in `items` is freshest-first (`store.sortItems`; for equal `time` the order is
  stabilized by the headline).
- Only headlines the user deleted personally (the delete icon in the reader and “Delete all”)
  get into `read`. A headline expired by `clean_timeout` is not written to `read`: its term
  expired not by the user's will. A mark lives `read_ttl_days` days (7 by default; set on the
  global settings screen), counted from the later of `pubDate` and the deletion moment
  (`util.readTime`), so a recently deleted news item does not “come back to life” early even if
  it was published long ago. The “Forget read items” button on the same screen wipes the whole
  list at once.
- The theme is additionally cached in `window.localStorage` (`rss-reader:theme`) so the page
  gets its colors immediately without waiting for an asynchronous read from
  `chrome.storage.local`.
- The sizes of the reader columns are cached the same way (`rss-reader:font-scales`): `src/font-boot.js`
  paints them before the page module runs, so a column never shows its text at another size first.
- Deleting a feed also deletes its headlines (`store.deleteFeed`); they do not get into `read`:
  the feed was deleted wholesale, and on re-adding it the headlines are read anew.

## Page ↔ service worker messages

Pages write to storage themselves, while alarms and the badge belong to the background, so they
communicate like this:

| Message | From where | What the background does |
|---|---|---|
| `MSG_REFRESH_FEED` (`feedId`) | reader “Refresh”, settings screen “Load now” | reads the feed and saves the headlines; replies `{ok, added, skipped, seen}`, where `skipped` is how many headlines were rejected as already read; no sound |
| `MSG_FEEDS_CHANGED` | reader (on opening), settings screen (after save/delete) | rebuilds alarms from the feed list, clears expired items, updates the badge |
| `MSG_COUNT` | not used by pages yet (reserved) | replies `{ok, count}` — the number of headlines in storage |
| `MSG_PLAY_SOUND` (`src`) | only `sound.playSound` from the background | the offscreen document plays the audio file selected on the settings screen from `src/media` |
| `MSG_FETCH_FEED` (`url`) | only the background (`background.readFeed`) | the offscreen document reads the feed and parses it, replies `{ok, result}` or `{ok:false, error}` |

Additionally, pages and the background listen to `chrome.storage.onChanged`: a change in `feeds`
rebuilds alarms, a change in `items` updates the badge and the lists, a change in `settings`
(theme, `read_ttl_days`, the selected `sound_file`, `language` or the column sizes of `font_scales`)
runs the cleanup under the new rules, and the pages switch the language of their labels — and the
reader repaints the size of the column whose size changed, wherever that change came from. This is
why the screens never “drift apart” from the background.

## Limits and constants

| Constant | Value | Where |
|---|---|---|
| `MIN_ALARM_PERIOD_MINUTES` | 1 | `util.js` — the floor for `delay_timeout` |
| `CLEAN_PERIOD_MINUTES` | 1 | `util.js` — how often `clean_timeout` is checked |
| `DEFAULT_DELAY_TIMEOUT` | 30 min | `util.js` |
| `DEFAULT_CLEAN_TIMEOUT` | 1440 min (1 day) | `util.js` |
| `MAX_ITEMS_PER_FEED` | 100 | `util.js` — how many freshest headlines of one feed are stored |
| `MAX_ENTRIES` | 50 | `rss.js` — how many entries are taken from one feed response |
| `READ_TTL_DAYS` | 7 days | `util.js` — the **default value** for the “read” mark lifetime; configurable via the `read_ttl_days` field |
| `MIN_READ_TTL_DAYS` / `MAX_READ_TTL_DAYS` | 1 / 3650 | `util.js` — bounds of this field (`util.toDays`) |
| `MAX_READ_RECORDS` | 1000 | `util.js` — how many such marks are stored; the oldest are evicted first |
| `MAX_PARAGRAPHS` / `MAX_CHARACTERS` | 60 / 16000 | `extract.js` — the limit of article text in the right panel |
| `MIN_PARAGRAPH_LENGTH` | 40 | `extract.js` — short lines (menus, captions) are not counted as article text |
| `ALARM_PREFIX` / `CLEANUP_ALARM_NAME` | `feed:<id>` / `rss-reader:cleanup` | `util.js` |

## Implementation notes

- **`delay_timeout` cannot be under 1 minute**: release Chrome does not allow alarms with a
  period under a minute (`util.alarmPeriodMinutes`). The value is stored in minutes as is. The
  first automatic load of a new feed happens `delay_timeout` after saving; right after saving
  the feed is re-read manually, so the reader is never left empty.
- **`clean_timeout` is also in minutes**; the term is counted from the headline's `time`, so
  editing a feed's `clean_timeout` immediately affects its already-stored headlines. Expired
  headlines are purged by an alarm once a minute, and also when the reader opens and on any feed
  change. A headline “without a parent feed” (the feed was deleted while the alarm was queued)
  is removed.
- **Duplicates**: a headline is identified by `uid = feedId + "|" + link`, so re-polling a feed
  neither spawns copies nor resets the storage term of an existing record.
- **The badge counts the headlines of all feeds together** (the entire contents of `items`), as
  the assignment states: `1…99` as a number, `*` when over 99, empty at 0.
- **Chrome picks the badge digits' color itself**: the `chrome.action` API does not allow setting
  the digit color — only the background color, so the background was made yellow and
  theme-dependent (dark theme `#ffd54f`, light `#e6a817`): this way the digits stay clearly
  visible on both the dark and the light Chrome toolbar. The previous blue accent `#1e88e5`
  hid them.
- **The article content** is extracted from HTML as text (text nodes only), so no foreign
  markup, scripts or styles get onto the extension page. Boilerplate blocks (`nav`, `footer`,
  `iframe`, `form`, etc.) and blocks with “advertising” class/id are cut out of the page. If no
  text is found (the feed serves only an excerpt, or the page is built by scripts), the right
  panel shows a message and the link to the original remains.
- **RSS 2.0, Atom and RDF are supported**: `<item>` and `<entry>` are parsed, the `link` in Atom
  (`rel="alternate"`), `guid` with `isPermaLink="true"` as a link; relative links are resolved
  against the feed URL; up to 50 entries per response.
- **The feed encoding is determined before writing to storage**: the response body is read as
  bytes (`response.arrayBuffer()`) rather than `response.text()` — the latter reads everything as
  UTF-8, which made a Windows-1251 feed (still served by Russian-language sites) land in
  `chrome.storage.local` as mojibake. `src/lib/encoding.js` searches for the encoding by how
  reliably it was found: byte-order mark (BOM), the `charset` of the `Content-Type` header, an
  `encoding=` declaration inside the XML or a page's `<meta charset>`. Each finding is tried
  strictly: a single-byte encoding rejects no bytes at all, so it is accepted only if the
  resulting text matches it (UTF-8 read as Windows-1251 produces letters of foreign alphabets —
  `ЂѓљҐґї`). If there are no declarations or they do not match, UTF-8 is tried first (most feeds
  use it), then — the single guess this reader needs, Windows-1251, and only when the bytes
  genuinely produce Russian text rather than text of a foreign alphabet; everything else is read
  as UTF-8 with replacement so a feed is never refused because of an encoding nobody declared.
  Text enters `DOMParser` already decoded, so `retargetXmlDeclaration` rewrites the declaration
  in it to the encoding the bytes were actually decoded as. Storage holds text, not bytes, so
  there is no way to misread them a second time; if the declared encoding did not match the
  bytes, `rss.js` writes a `console.warn` about it. The decoding rules are held by the tests in
  `scripts/test.mjs`.
- **Sound** — playing the signal selected on the global settings screen: it is played by the
  offscreen document via `<audio>` (`reasons: ["AUDIO_PLAYBACK"]`), because a service worker is
  not allowed a DOM. The file address is passed by the background in a message (`MSG_PLAY_SOUND`
  with `src`), and the offscreen document resolves it via `chrome.runtime.getURL(src)` — the file
  lives inside the extension, so neither `web_accessible_resources` nor the network is needed for
  it. There is one player in the offscreen document and it is reused: the file loads once, a
  repeated signal interrupts the previous playback and starts from the beginning. The file is
  chosen on the global settings screen: the combobox (“No sound” / a file from `src/media`)
  writes it to `settings.sound_file`, and `playSound` (`src/lib/sound.js`) reads this choice and
  does nothing when `SOUND_NONE` (“No sound”) is set. The file list is fixed by the `SOUND_FILES`
  constant in `src/lib/storage.js` (ariel, carme, ceres, titan, …); an unknown path is normalized
  by storage to `DEFAULT_SOUND_FILE` (`src/media/ceres.mp3`), so the signal only ever plays from
  `src/media`. The `settings.sound` flag (the same key `true`/`false`) remains for compatibility
  with builds that predate the combobox.
- **XML parsing happens in the offscreen document, not in the background**: an MV3 service worker
  has no DOM, so `DOMParser` is absent there (`rss.js` is called from `src/offscreen.js`; the
  document has the `DOM_PARSER` permission). The background asks the document to read the feed
  (`MSG_FETCH_FEED`) and receives finished headlines rather than XML. The same document serves
  sound (`AUDIO_PLAYBACK`): there is one window, created as needed and reused.
- **A deleted news item does not come back**: the `read` storage key holds the links of headlines
  the user deleted personally. `store.addItems` does not add a headline whose link is already in
  this list, so a feed that has been serving the same set of news for years does not refill the
  reader every `delay_timeout`. A mark lives `read_ttl_days` days (by default `READ_TTL_DAYS` =
  7), `store.cleanupRead` cleans it with the same alarm once a minute, and the list holds at most
  `MAX_READ_RECORDS` records: it does not grow without bound, but a once-very-old news item
  eventually gets a chance to enter the reader again.
- **The read-item lifetime is a user setting, not a constant**: `store.cleanupRead` reads
  `read_ttl_days` from `settings` every time, so a value saved on the global settings screen via
  the “Write” button already applies at the next check: shorten the period — marks older than the
  new horizon are purged immediately (the background does this on the `chrome.storage.onChanged`
  event), and deleted news items return to the feeds at the very next load.
- **One screen — one tab**: clicking the icon spawns no copies — `tabs.focusOrCreateTab` finds
  the already-open reader tab by its URL and activates it together with its window (open in
  several windows → the one where you clicked is chosen). The “Feed settings”, “Global settings”
  and reader icons — one and the same row on all three screens — move between them within the
  same tab; the selected feed and open headline survive this transition — they
  lie in `sessionStorage`, which lives as long as the tab does. This is the only reason for the
  `tabs` permission.
- **Cursor when the reader opens**: a fresh reader tab is not opened with empty panels — `init()`
  selects the first feed in the list and its first (freshest) headline, which is immediately
  shown in the right panel. If the tab returned from a settings screen, the choice from
  `sessionStorage` outweighs auto-selection; but if the saved feed has meanwhile been deleted and
  its headline has expired by `clean_timeout`, the reader still selects the first feed and its
  first headline.
- **The interface language is a dictionary, not a page translation**: all labels, tooltips
  (`title`), `aria-label` and messages lie in seven flat dictionaries — `ru`, `en`, `uk`, `pl`,
  `de`, `fr` and `es` — in `src/lib/i18n.js` under shared keys (`reader.*`, `feeds.*`,
  `settings.*`, `errors.*`, `units.*`). The markup carries a key instead of text (`data-i18n`,
  `data-i18n-title`, `data-i18n-aria`); live text is built by `t(key, params)`, so adding a
  language means adding a dictionary rather than hunting strings across the screens. The chosen
  language is cached in `localStorage` (`rss-reader:language`): extension pages of one origin
  share the same `localStorage`, so labels are re-pasted before the read from
  `chrome.storage.local` resolves. Language names in the combobox are not translated (“Русский”,
  “Deutsch”) — that way they are easier to recognize.
- **A feed refusal travels as a code, not as text**: `rss.js`, `lib/offscreen.js` and
  `lib/extract.js` mark an error with `code`/`params`, and `src/background.js` and the offscreen
  document pass them to the page as they are (for any error with a `code`, not only `FeedError`),
  so `errors.<code>` is rendered in the reader's language; the technical `message` stays in the
  console. For the same reason no translation is frozen into storage: a headline without a title
  is stored empty, and the reader substitutes `common.untitled` (the test `an error thrown for a
  page names a key every language translates` makes sure every code has a translation in every
  language).
- **No third-party dependencies**: feed polling and parsing are done by `fetch` under
  `host_permissions: <all_urls>`, the manifest requires no RSS parsing library, and XML is parsed
  by the built-in `DOMParser` — but exactly where it is allowed.

## Validation

```bash
node scripts/test.mjs        # unit tests of pure functions (util.js, i18n.js, encoding.js, parts of
                             # storage.js) and the guards over the screen markup: 41 tests
node scripts/make_icons.mjs  # regenerate the icons (no dependencies)
node scripts/check_icons.mjs # make sure the icons are correct
```

The tests do not cover `chrome.*` code (alarms, action, offscreen, messages) or XML parsing —
that is checked in the browser after loading the extension.

### What to check in the browser

1. Add a feed → headlines appear in the reader with no waiting.
2. Set `delay_timeout: 1` on a feed → after a minute new headlines appear, the badge grows, a
   signal plays.
3. Set `clean_timeout: 1` → after a minute the headlines disappear from the reader and the badge
   resets to zero.
4. More than 99 headlines → the icon shows `*`.
5. The delete icon in the corner of the right panel → the headline vanishes from both the list
   and storage, and the reader immediately opens the next headline of the same feed.
6. Switch the theme on one screen → the other screen repaints without a reload.
7. Hover the reader icon → a tooltip explains what it does.
8. Click the “Delete all” button next to the counter → all headlines vanish from storage, the
   number in the header resets to zero, the icon badge empties. The feeds themselves remain.
9. Click the plugin icon twice → there is no second reader tab: Chrome activated the already open
   one (and its window). Same for a reader open in another window.
10. In the reader select a feed and a headline → the “Feed settings” icon → the settings open in
    this same tab → the reader icon → the same feed and headline are open again.
11. Open the reader in a new tab (feeds and headlines already exist) → the first feed is
    highlighted, in the middle panel the freshest headline of that feed is highlighted, its text
    is visible right away, without a click.
12. Delete a headline (the trash icon above the text) and wait for this feed's next load → the
    deleted news item does not reappear. On the settings screen, “Load now” on the same feed
    shows the status `already read: N`.
13. The “Global settings” icon in the top-right corner of the reader (the last of the three, before
    the theme toggle) → the global settings screen opened in this same tab; the reader icon on it
    returned to the same feed and the same headline. The “Extensions: details” button of the
    extension in `chrome://extensions`
    opens the same global settings screen (in a separate tab).
14. On the global settings screen set `read_ttl_days: 1` and press “Write” → the card shows the
    number of marks and the new term, and the “Write” button becomes inactive. Delete a headline,
    a day later re-read the feed → the news item reappears. Without pressing “Write”, enter
    `read_ttl_days: 3651` or a fractional value and press “Write” → the field hints that an
    integer from 1 to 3650 is required and the storage value does not change (until the button is
    pressed, the field writes nothing at all).
15. The “Forget read items” button → with a confirmation cleared the list: under the field
    “no read marks” appears, and previously deleted news items return to the feeds at the next
    load.
16. In the sound combobox choose another mp3 from `src/media` → “Write” → the next automatic
    headline load is accompanied by the chosen signal. Choose the first row “No sound” → “Write”
    → the load is no longer voiced.
17. In the “Interface language” combobox choose another language → “Write” → the labels,
    tooltips and messages of this screen change immediately, and the reader and the feed screen
    open in other tabs re-paste without a reload. First launch (no `language` in storage) → the
    language is taken from the browser; a browser language that is not among the dictionaries →
    `English`.
18. Add a feed that answers in Windows-1251 (for example
    `https://nnmclub.to/forum/rss.php?f=2&show=0` or `https://nnmclub.to/forum/rssp.xml`) → the
    headlines read as Cyrillic rather than as characters like `ÐºÐ¾Ð»Ð»ÐµÐºÑ†Ð¸Ñ`; the console
    encoding warning appears only where the declared encoding did not match the bytes.
19. Compare the top-right corner of all three screens → the row of three icons stands in the same
    place and looks the same everywhere, the icon of the screen you are on is highlighted and is
    not clickable; hovering over any icon gives a tooltip naming the screen it leads to, and the
    tooltip changes together with the interface language.
20. Press the largest “A” in the head of the middle panel → only the headlines grow, the feed list
    and the article text keep their size. Close the reader and open it again → the middle panel is
    large again. In a second reader tab change the size of the right column → the open first tab
    repaints without a reload.

## Limitations

- **At least 1 minute** for both `delay_timeout` and `clean_timeout` (the expiry check itself
  runs once a minute) — Chrome will not allow finer.
- **At least 1 day** for `read_ttl_days`: “forget read items immediately” is the “Forget read
  items” button, not a zero term.
- **Article text cannot always be extracted**: pages built by JavaScript, pages behind paywalls,
  or feeds that serve only an excerpt will show a message about it and the link to the original.
- **The service worker “sleeps”** between Chrome events; this is normal for MV3. Alarms survive a
  worker restart, and on every wake-up `bootstrap()` re-reconciles the alarms, cleans expired
  headlines and updates the badge.
- **The offscreen document is created only when a DOM is needed** — parsing a feed or playing
  sound — not permanently; afterwards it is reused. The first feed read after a background
  wake-up is slightly slower than the rest because the window still has to be created.
- **Seven interface languages** (`ru`, `en`, `uk`, `pl`, `de`, `fr`, `es`): the list is fixed by
  `LANGUAGES` in `src/lib/i18n.js`, and a browser language outside this list falls back to
  `English`. Chrome takes the extension's own name and description from `_locales` by the browser
  language, not by the language chosen in the reader.
- **`host_permissions: <all_urls>`**: the extension can read any site a feed or news link leads
  to. This follows from the assignment, not from an excess of privileges.

## Author

Andriy Melnyk (Андрей Мельник) — [andriejsoft@gmail.com](mailto:andriejsoft@gmail.com)

Repository: <https://github.com/AndriejM/RssReader>

## Development

The project was created by VibeCoding with:

1. **StrataLLM** — <https://github.com/Niko1221/Strata>, model `qwen3.8-flash-next-iq3_xxs`
2. **Zed** editor — <https://zed.dev/>

## License

Released under the MIT License — see [LICENSE](LICENSE). You may use, copy, modify, merge,
publish, distribute, sublicense and/or sell copies of this software, provided the copyright
notice and the license notice are kept with it. The software is provided without any warranty.
