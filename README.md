# RSS Reader — a Chrome extension

[Русская версия: README.ru.md](README.ru.md)

**Repository:** <https://github.com/AndriejM/RssReader>

Reading RSS news: a feed settings screen, a global settings screen, a three-panel reading
interface, automatic headline loading on a schedule and their automatic cleanup once their
storage time expires.

The extension has no third-party dependencies and requires no build: after the folder is loaded
all features work, and the network is needed only to read the feeds and articles themselves.

## Author

Andriy Melnyk (Андрей Мельник) — [andriejsoft@gmail.com](mailto:andriejsoft@gmail.com)

## Development

The project was created by VibeCoding with:

1. **StrataLLM** — <https://github.com/Niko1221/Strata>, model `qwen3.8-flash-next-iq3_xxs`
2. **Zed** editor — <https://zed.dev/>

## License

Released under the MIT License — see [LICENSE](LICENSE). You may use, copy, modify, merge,
publish, distribute, sublicense and/or sell copies of this software, provided the copyright
notice and the license notice are kept with it. The software is provided without any warranty.

## Requirements

- **Chrome 116 or newer**, declared in the manifest as `minimum_chrome_version`. The
  `chrome.offscreen` API itself arrived in Chrome 109 — a service worker has no DOM, so an offscreen
  document is created to parse the feed XML and to play the signal file. But telling whether that
  document already exists needs `chrome.runtime.getContexts` (Chrome 116) or
  `chrome.offscreen.hasDocument` (Chrome 150): below 116 the reader cannot know, so it would create a
  second document, fail, and report the offscreen document as unavailable.
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

The parts every screen needs to be used by an ear and by a keyboard live in `src/styles/theme.css`,
the stylesheet all three load: the `:focus-visible` outline a button, an input, a select, a link or
the «?» disclosure of a screen takes when the keyboard reaches it; `.sr-only`, the line a screen
reader reads and an eye never sees, from which each screen says what its buttons just did; and
`@media (prefers-reduced-motion: reduce)`, which stops the colours of a button cross-fading under
the pointer. A screen that spins a glyph or fades a handle answers for that in its own stylesheet,
where those parts are drawn.

## Quick start

1. Open “Feed settings” (the icon in the top-right corner) → the “add feed” icon above the table.
2. Fill in the row: the feed name, the link, the headline fetch period and the news storage time →
   the “save” icon at the end of the same row (in storage these are `name`, `rss_link`,
   `delay_timeout`, `clean_timeout`).
   The feed is re-read once right away, so headlines appear immediately without waiting for the
   first alarm to fire.
3. Open the reader (click the toolbar icon or the reader icon in the top-right corner) → the
   “All feeds” row and the freshest headline of all the feeds are already selected, the article
   text is in the right panel; afterwards, clicking a feed on
   the left or a headline in the middle panel switches the panels.
4. From then on the feed is polled automatically every `delay_timeout` minutes; new headlines
   are marked with a badge on the icon and a short sound.

A first run does not have to know what to do: a reader with no feeds meets you with a card in the
empty middle column — “No feeds yet” and a button “Open feed settings” — and the first row you save
on the feed screen confirms the result with a line under the table, “Feed added, its first headlines
loaded”. Both cases are described below.

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
- **“Export feeds” (the down-arrow icon above the table)** — writes the whole table to a
  `rss-reader-feeds.json` file: only the name, the link and both minute fields of every feed (see
  the feeds file under “Data schema”).
- **“Import feeds” (the up-arrow icon above the table)** — asks for such a file and adds its feeds
  to the table. A feed whose link is already here is left exactly as it is — its name, its minutes,
  its icon and its headlines are not touched; a row that fails the check a row of the table fails
  is not added either. The result is counted in one line under the table, and an added feed is
  handed to the worker, so its own period starts without waiting for anything.
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

The first row you add gets a word about the whole table rather than about its own row: the line
under the table (“Feed added, its first headlines loaded”) says what until that moment was only a
supposition — that the reader now has something to show. It comes once: `settings.first_feed_done`
is set by the first successful add and never taken back, so the next saved row does not repeat the
same confirmation. And it speaks about headlines only when they really came: a feed whose server
could not be read names its failure in the note of its own row, and repeating it under the table
would be pointless (the same holds for a row that answers “already being read”). The line is an
ordinary `setTransferStatus`, so it is said out loud as well.

Under every saved feed a quieter line carries its health record (see the storage section): when the
feed was last read, when its next check is due, and — while it is currently failing — the reason in
the interface language, how many failures ran in a row and how long an automatic read leaves the
feed alone before asking it again. It stays put while the load message above
it comes and goes, and a healthy feed that was read cleanly shows only the check and the next one.
A manual “Load now” refreshes this line with the attempt that just happened.

What those lines say is said out loud too: a feed saved, a row whose fields were left unfilled,
what “Load now” brought back (“New: 5”), how many feeds a file took and how many it gave back. The
same `setStatus` and `setTransferStatus` write both the visible line and the hidden one
(`#feeds-announce`, `role="status" aria-live="polite"`), so the two can never disagree. The table
names itself for a screen reader through a `<caption>` no eye sees (`feeds.caption`): the `<th>` row
is a head a sighted person reads, not a name said when a reader enters the table.

Screen header: the row of screen-switcher icons (here its “Feed settings” icon is the highlighted
one) and the theme toggle.

## Reading screen (`src/index.html`)

Three vertical panels:

1. **Feeds** — a list of feeds with their headline counts and update periods. Above the list
   stands a separate “All feeds” row: it is not a feed, so it is set in the accent colour, is
   larger than a feed row, is closed off from the list by a rule, and its label counts the
   headlines of every feed instead of naming one feed's refresh period. The refresh icon at the
   top of the panel re-reads the selected feed once — “All feeds” makes it read every feed at once
   (no sound at that moment) — and spins while loading. Clicking a feed puts the middle panel on
   its first (freshest) headline, and its text opens in the right panel right away; clicking “All
   feeds” puts it on the freshest headline there is, whichever feed it came from. A feed whose last
   read failed is set apart: a warning glyph stands beside its name, the number of its failures runs
   under the name in the colour of a failure. Any feed that has been read carries a tooltip: when it
   was last read, when its next check is due, and — while a failing feed sits out its pause — how
   much longer an automatic read leaves it alone.
2. **Headlines** — headlines of the selected feed from storage, freshest on top, with a
   “loaded N min ago” label and a storage time counted down from `clean_timeout`. When “All feeds”
   is selected, the headlines of all the feeds stand here, also freshest on top, and each one is
   labelled with the name of the feed it came from.
3. **Content** — the article text loaded at the moment of the click. The article headline in the
   right panel is itself a link to the original (new tab); in the corner above the text there is
   a delete icon: it removes the headline from the list and from storage, immediately opens the
   next headline of the same feed (or, when “All feeds” is selected, the next headline by date),
   and remembers the deleted one as read — on the next feed load it will no longer appear.

In the head of every panel there is its own font size switcher: four buttons drawn as the letter “A”,
each at the size it stands for. A button scales only the column it sits in — the feed list, the
headline list and the article text are sized independently, so the middle column stays compact while
the article is read at a large size. The size of a column is written to storage as soon as it is
chosen (`settings.font_scales`) and is applied again when the reader opens; two reader tabs keep the
same sizes, and a size chosen in one tab repaints the other without a reload.

The border between two columns is a handle: hover it and a thin accent line lights up in the gap,
press and hold the left mouse button and move the mouse left or right — the column to the left of
the border takes the width and its neighbour gives the rest back. The article column is never
dragged: it keeps whatever width the window leaves it. A column stops at 160 px and never grows
past 900 px, and a drag cannot push a neighbouring column under 160 px either, so the border
simply stops moving where a neighbour would start to vanish. The width is written to storage when
the button is released (`settings.column_widths`), not while the border moves — a press that never
moved writes nothing — and the reader opens at the remembered widths; two reader tabs keep the same
widths, and a border moved in one tab repaints the other without a reload. In a window narrower
than 980 px the panels wrap into two rows, and only the border between the two lists stays a
handle.

When the reader opens, no cursor is left empty: the “All feeds” row is selected, the middle panel
has the freshest headline of all the feeds, and its text is shown in the right panel right away. A
click on any feed of the left column behaves the same way — the middle panel always moves to the
first headline of whatever is selected, one feed or all of them. There is exactly one case of
opting out of auto-selection: returning from a settings screen in the same tab restores precisely
the feed and precisely the headline you were on (more on this below).

While storage holds no feed at all, the middle column has nothing to list, and a card of a first run
stands there in place of the list: the RSS glyph, “No feeds yet”, a hint about where the headlines
and the news text will appear, and the button “Open feed settings” — the same move in the same tab
as the feeds icon of the screen switcher. Until the first feed exists, the search field and the load
and clear buttons of that column are hidden (they would act on an empty selection) and `/` does not
take the focus to a field that is not there. The right panel says the same about a first feed where
an article would stand: “select a headline” with no feeds would advise choosing something that does
not exist. The card stands exactly where the future list begins and disappears once a feed is saved.

At the top of the reader there is a counter: the total number of headlines of all feeds in
storage; in the top-right corner sit the screen-switcher icons and the theme toggle (the reader
icon is the highlighted one).

The head of the middle column holds two icons to the right of the feed's name, and both follow
whatever the left column has selected. An RSS-icon button loads headlines: with one feed selected
it reads just that feed; with «Все ленты» it reads every feed of the list one after another in the
order of that list, without waiting for the period of each. It spins while the feeds are read, a
feed that refuses to be read does not stop the others (the reader says how many failed and keeps the
headlines those feeds already have), and — as with a single refresh — no sound plays. A trash-icon
button then removes from storage exactly what is selected: a single feed's headlines, or (with
«Все ленты») every headline, remembering them as read so the next load does not bring them back
(the feeds themselves remain). The counters update when the background downloads or cleans up
headlines, so an open reader never shows stale data.

The “Feed settings” icon opens the settings in the same tab — no second tab appears — and the
reader icon on a settings screen returns the same way: to the same feed and the same
open headline. The “Global settings” icon (the last of the three, before the theme toggle) opens
the global settings screen the same way.

Beside the name of the feed, the head of the middle column holds a search field. It narrows the
headlines of whatever is selected — one feed, or all of them — to those whose title or feed name
carries every word that was typed, and it changes nothing about their order; the counter beside the
name counts what is left, and a search that matches nothing says so in both the middle and the right
panel. Deleting a headline while the field holds words hands the reader to the next headline the
search still shows. What is typed belongs to the reading position, so a reader that comes back from a
settings screen comes back to the same filtered list.

Under that head stands one quiet line about the load of whatever is selected now: when its headlines
last came in (`lastFetchedAt`) and when they are next asked for on their own. For one feed the second
is that feed's alarm; for «All feeds» it is the earliest alarm among all the feeds. The moment comes
from the schedule Chrome really runs — `syncAlarms` reads it off the alarms themselves — so the line
answers «why has nothing arrived» without opening the service worker console: *headlines fetched 4
min ago · next check in 26 min* says the reader asked recently and the site has nothing newer. A
`304` is a check that brings no headlines, so it moves the next check but not the age of what lies
here. The line redraws once a minute while the reader tab is visible (and at once when the tab
becomes visible again), so «4 min ago» does not freeze, and a feed nobody has read yet leaves the
line off entirely.

The reader answers to the keyboard, and its keys are held back while a field is being typed in (the
search field holds the same letters) or while Ctrl/Meta/Alt are down:

| Key | What it does |
| --- | --- |
| `/` | put the cursor in the search field |
| `↓` or `j` | open the next headline of the current selection |
| `↑` or `k` | open the previous headline of the current selection |
| `Enter` | open the original of the open headline in a new tab |
| `r` | re-read the selected feed («All feeds» — every feed) |
| `d` | delete the open headline |
| `Esc` (in the search field) | empty the field, keeping the open headline |
| `?` | open (or close) the list of these keys, inside the reader |

The arrows work from inside the search field too: they leave the words typed and move the cursor
through the headlines the field filters. Every move brings the row it landed on back into view, and the
row the keyboard opens also takes the focus, so its name is read out and the next arrow continues from
it.

The same list stands inside the reader, where the keys are used: the «?» icon at the right of the header
and the `?` key open it, and a modal window shows a table of the keys with the shortcut of each one and
a line about the keys being held back during typing. It is a real `<dialog>` opened with `showModal()`:
its own close button, `?` and `Esc` close it, a click beside the card closes it, the keyboard cursor is
locked inside it while it stands, and the header and the three columns carry `aria-hidden` for that time
so a Tab never walks out of the list. None of the reader keys work through the open list — a headline is
never deleted through the table that explains how to delete one. Its captions are ordinary dictionary
keys (`reader.keys.*`), so the list speaks the language chosen on the global settings screen.

The reader also says out loud what repainting a panel just did — how many headlines came in, how many
feeds refused, what was removed («5 new headlines», «3 feeds could not be refreshed», «headline
deleted»). A line no eye sees (`#reader-announce`, `role="status" aria-live="polite"`, hidden through
`.sr-only`) carries it, and the same facts stand where the eye reads them: the counters of the panels
and the placeholders. The middle column is a `listbox` whose rows are `option`s, the open headline
among them is `aria-selected`; the chosen row of the left column carries `aria-current`. A keyboard
cursor is drawn around the whole row (`:focus-visible`, in a colour that reads against a filled row),
and `prefers-reduced-motion: reduce` drops the spinning refresh glyph and the fade of a border handle.

## Global settings screen (`src/settings.html`)

Settings that apply to the reader as a whole rather than to a single feed. It opens via the
“Global settings” icon in the top-right corner of any screen, and also via the “Extensions:
details” button in
`chrome://extensions` (`options_ui` in the manifest). Fields:

| Field | Meaning | Units | Default | Constraints |
|---|---|---|---|---|
| `read_ttl_days` | how many days to forget read items: the period that keeps a deleted news item from coming back from the feed | days | 7 | integer from 1 to 3650 |
| sound on/off | checkbox to the left of the signal combobox: whether an automatic load plays the signal at all — its own switch, independent of the chosen file, its volume and the load message | — | on | on/off |
| sound on download | combobox: which mp3 from `src/media` to play when an automatic load brings headlines | — | `ceres.mp3` | only files from `src/media` |
| signal volume | slider to the right of the preview-play icon: how loudly the signal plays — both the preview on this screen and the alert after an automatic load | percent | 100 | 0 to 100, in steps of 5 |
| show a message | checkbox: after an automatic load brings headlines the extension shows a system popup naming how many new headlines it received — its own switch, the signal plays or stays silent by its own flag | — | off | on/off |
| interface language | combobox: which language the labels, tooltips and messages of all screens use (“Русский”, “English”, “Українська”, “Polski”, “Deutsch”, “Français”, “Español”) | — | the browser language; if it is not among the supported ones — `English` | only languages from `src/lib/i18n.js` |

The fields themselves write nothing to storage: the period, the signal and the language go there
only via the **“Write”** button. While a field's value differs from what is stored, the button is
active and “Changes not saved” appears at the bottom of the card; after saving, the same spot
shows “Saved: marks burn out in M days · sound: <file> · language: <language>”. Below the field
are the value currently in storage and the number of marks it holds (“read marks: N · burn out
in M days”). Next to the field is the **“Forget read items”** button (with a confirmation): one
press clears the entire `read` list without waiting for `read_ttl_days` to expire, so news items
you deleted earlier may come back on the next feed load.

All six values live under the `settings` key in `chrome.storage.local` — in the same place as
the theme. The service worker reads them: the period — when it purges read items, so a horizon
saved via “Write” immediately wakes up the cleanup and applies to automatic loading; the `sound`
flag — to decide whether the alert plays at all after that same load; `sound_file` and
`sound_volume` — which file plays then, at which volume; `show_message` — to decide whether
that same load also shows a popup with the number of new headlines.

The interface language is taken by the pages: `settings.language`, and if there is no stored
value (first launch) — the browser language (`navigator.language` and `navigator.languages`),
and only if it is not supported by the extension — `English`. A saved language takes effect
right away: the screen where it was changed re-pastes its own labels without a reload, and the
reader and the feed screen pick up the change via `chrome.storage.onChanged`.

The result of pressing “Write” — what was written, that a days field was refused, how many read
markers “Forget read” removed, why a preview signal did not play — is also said out loud from a
hidden line (`#settings-announce`, `role="status" aria-live="polite"`). Only outcomes are spoken:
the «changes are not written yet» hint stands under the fields from the first keystroke, and
repeating it by ear on every keystroke would drown the screen. The table of fields names itself
through a `<caption>` no eye sees (`settings.caption`).

Screen header: the row of screen-switcher icons (here its “Global settings” icon is the
highlighted one; the reader icon returns to the reader in this same tab, keeping the selected feed
and headline) and the theme toggle.

## Structure

```
manifest.json                 MV3, permissions: storage, unlimitedStorage, alarms, offscreen,
                              tabs, notifications
icons/                        RSS icon (16/32/48/128), generated by a script
src/background.js             service worker: feed polling (one feed read at a time), cleanup,
                              badge, sound, load message, icon click
src/index.html|js             three-panel reader (feeds → headlines → content)
src/feeds.html|js             feed configuration screen: add / edit / delete, and the whole table as
                              a file (export and import)
src/settings.html|js          global settings screen: lifetime of the read list, its manual
                              cleanup, sound on/off checkbox, combobox of the signal file (mp3
                              from media) with its volume slider, checkbox of the load message,
                              and combobox of the interface language
src/lib/i18n.js              every label, message and tooltip: the `ru`, `en`, `uk`, `pl`,
                              `de`, `fr` and `es` dictionaries, `t(key, params)`,
                              `applyI18n()`, units, browser language
src/lib/i18n-boot.js         apply the stored language before the page is drawn by its module
src/lib/errors.js             turn a feed error (`{code, params}`) into text in the page's language
src/offscreen.html|js         offscreen document: the extension's only context with a DOM — the
                              feed answers are read here (XML with DOMParser, JSON Feed as JSON) and
                              sound is played here
src/lib/messages.js           message names between pages and the service worker
src/lib/storage.js            feeds, headlines, read list, settings, feed read locks, automatic
                              cleanup, and the feeds file the feed screen writes and reads
src/lib/alarms.js             an alarm per feed + a periodic-cleanup alarm
src/lib/offscreen.js          creating the offscreen document and exchanging messages with it
src/lib/rss.js                loading and parsing RSS 2.0 / Atom / RDF / JSON Feed (runs inside
                              the offscreen document)
src/lib/encoding.js           response bytes → text: find the feed's encoding (BOM, `Content-Type`,
                              the XML declaration) and decode it with it (covered by tests)
src/lib/extract.js            article text extraction on a headline click
src/lib/favicon.js            read a feed's site page and find the favicon it declares: the link is
                              stored on the feed when the feed is added (the pure reading is covered
                              by tests)
src/lib/sound.js              whether to play the alert at all (the «Sound» flag) and which
                              signal file to play (reads the choice from the settings screen)
src/lib/notify.js             the system popup about headlines an automatic load brought: silent
                              until «Show a message» is written on the settings screen
src/media/                    signal audio files: the one selected on the settings screen plays,
                              while the «Sound» flag is on
src/lib/theme.js              light/dark theme
src/lib/fontsize.js           the size switcher in the head of a reader column: every column is sized
                              on its own, its size is written to the settings
src/font-boot.js              paint the remembered sizes before the page is drawn by its module
src/lib/columns.js            the draggable border between reader columns: it sizes the column on
                              its left, keeps it inside its limits and writes the width to the
                              settings when the button is released
src/columns-boot.js           paint the remembered widths before the page is drawn by its module
src/lib/nav.js                the row of screen-switcher icons: the same one on all three screens,
                              its tooltips taken from the dictionary (`nav.*`)
src/lib/tabs.js               one extension screen — one tab: find the open tab and activate it
                              instead of opening a second one
src/lib/util.js               pure functions without chrome.* (covered by tests)
_locales/                     the extension's own name and description in each of the seven
                              locales (en|ru|uk|pl|de|fr|es) — Chrome picks them by the browser
                              language (`__MSG_extensionName__` in the manifest)
src/styles/                   theme.css (theme CSS variables, and for every screen the focus
                              outline, `.sr-only` and the answer to reduced motion), reader.css,
                              feeds.css, settings.css
scripts/test.mjs              unit tests of the pure functions: node scripts/test.mjs
scripts/make_icons.mjs        regenerate the icons without dependencies
scripts/check_icons.mjs       verify the result of make_icons.mjs
examples/                     example_rss.xml — a sample feed; neither the reader code nor the
                              tests reference it; nnm_example_rss_item.xml — a sample feed in
                              Windows-1251: the decoding tests rely on it; example_json_feed.json —
                              a JSON Feed 1.1 sample: the JSON parsing tests rely on it;
                              feeds_export.json — a sample of the feeds file the import icon accepts
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
| 7 | Sound when an automatic load brings more than 0 headlines | `store.addItems` returns the number of new items → `sound.playSound` checks the «Sound» checkbox from the settings screen and reads the file selected there → the offscreen document plays it (`playSound` does nothing when the flag is off); manual “Refresh”/“Load now” produce no sound |
| 8 | A separate global settings screen (the same icon in the top-right corner of all three screens, the last of the three, before the theme toggle): `read_ttl_days` — how many days to forget read items, and a signal-file combobox with its on/off checkbox (all saved via the “Write” button), plus a button that fully clears the read list | `src/settings.html`, `src/settings.js`, `store.getReadTtlDays` / `store.setReadTtlDays` / `store.setSoundChoice` / `store.setSoundEnabled` / `store.clearRead` |
| 9 | Labels, messages and tooltips are factored into one configuration, from which the English one is derived; on the global settings screen a language combobox that is saved to storage; on load the reader takes the saved language, otherwise the browser language, otherwise English | `src/lib/i18n.js` (`ru` / `en` / `uk` / `pl` / `de` / `fr` / `es` dictionaries), `store.getLanguage` / `store.setLanguage`, `src/lib/i18n-boot.js`, `src/lib/errors.js`, `language-file` combobox in `src/settings.html` |
| 10 | When a feed URL is added its site page is read, the favicon it declares is found (or the site's `favicon.ico` is used), and a link to it is stored on the feed; the icon is shown in the left column next to the feed name, and in the middle column — in «All feeds» — next to every headline of that feed | `src/lib/favicon.js`, `attachFeedIcon` in `src/feeds.js`, `feedIconImg` in `src/index.js`, `.item-icon` in `src/styles/reader.css` |

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
  "clean_timeout": 1440,      // minutes
  "icon": "https://habr.com/favicon.ico" // site icon link (lib/favicon.js), read when the feed is added
}
```

A feed that has been read carries its own health record next to those settings — the reader's feed
row and the line under a feed row on the “Feed settings” screen are where it is shown:

```json
{
  "lastCheckedAt": 1760000000000,   // the last read, automatic or by hand, ms
  "lastOkAt": 1760000000000,        // the last read that worked, ms
  "lastErrorAt": 1759998200000,     // the last read that failed, ms
  "lastErrorCode": "feedTimeout",   // key errors.<code> of `lib/i18n.js`, when the failure is coded
  "lastErrorParams": { "seconds": 15 },
  "lastErrorMessage": "fetch failed", // kept under 300 characters
  "fetchFailureCount": 2,           // failures in a row; a read that worked sets it back to 0
  "nextAlarmAt": 1760001800000,     // when this feed's alarm is due to run, ms (Chrome's schedule)
  "nextRetryAt": 1760003600000      // when an automatic read may ask this feed again
}
```

None of these fields exists until the feed has actually been read, and changing the feed's
`rss_link` clears them: the failures described the old address. `nextAlarmAt` is what the reader and
the feed screen name as “next check”. `syncAlarms` writes it from the alarms Chrome really runs: the
moment the alarm states for itself — an alarm this sync has just created is read back once it exists,
so its row names the same millisecond — or, when that moment has already gone by, one period after
it; an automatic read hands the next period of the alarm that just ran to `markFeedChecked`. Only a
feed whose alarm has not been seen yet gets the formula (`alarmPeriodMinutes(delay_timeout)`, the one
`syncAlarms` creates the alarm with) counted from the last read. `nextRetryAt` is set only by a read
that failed and is the later of the two: it names the moment an *automatic* read may ask the feed
again (see “Implementation notes”), which is why the health line of a failing feed shows it rather
than the alarm time.

A feed whose server answers with validators (`ETag` or `Last-Modified`) carries those answers too:

```json
{
  "etag": "\"6f1a-2c9\"",                  // the `ETag` the server last answered with
  "lastModified": "Mon, 07 Oct 2024 09:30:00 GMT", // its `Last-Modified`, kept as an HTTP-date
  "lastFetchedAt": 1759857000000           // when the headlines these keys describe arrived, ms
}
```

They are the feed's side of a conditional GET (see “Implementation notes”): the next read asks with
them, and a server that answers `304` gets nothing parsed and nothing written. Like the health
record they belong to one address, so changing `rss_link` clears them too — an `ETag` of the old
feed would answer `304` for a different one.

`lastFetchedAt` is not one of those answers: every read that brought headlines writes it, including a
feed whose server sends no validators at all, and only a `304` leaves it where it was. It is kept
with the keys because it describes the same headlines, and it is what the reader names as “headlines
fetched … ago”.

**Feeds file** — what the export and import icons of the feed screen write and read
(`FEED_EXPORT_FILE_NAME` and `FEED_EXPORT_VERSION` in `lib/storage.js`). It carries only what a
person set: an `id` belongs to the profile that made it, and the health record and the server's
validators describe a read done there, so none of them travels.

```json
{
  "version": 1,
  "feeds": [
    {
      "name": "Хабр",
      "rss_link": "https://habr.com/ru/rss/all/all/",
      "delay_timeout": 30,
      "clean_timeout": 1440
    }
  ]
}
```

A file is accepted whole or refused whole: a version other than `FEED_EXPORT_VERSION` or a `feeds`
that is not a list is reported as such, and no half-read file is ever written. A row of the file
passes the same check the row of the table passes (`util.normalizeFeed`), and the feeds that pass
are **added** to the stored ones: a feed of a link that is already stored keeps its own name, its
own minutes, its icon and its headlines, because the point of the file is to bring feeds the
profile does not have yet, not to overwrite the ones it cares about.

**`items`** — an array of headlines. The fields from the assignment are `rss_link`, `title`,
`link`, `time`; `uid`/`feedId`/`feedName`/`sourceId`/`sourceIdType` were added internally: to
identify a headline and avoid duplicates.

```json
{
  "uid": "<feedId>|<sourceId>", // unique key of the headline
  "feedId": "c0f4…",
  "feedName": "Хабр",
  "rss_link": "https://habr.com/ru/rss/all/all/",  // link to the feed
  "title": "Заголовок новости",
  "link": "https://habr.com/ru/news/…/",            // http link to the news, as the feed wrote it
  "sourceId": "https://habr.com/ru/news/1",         // what the feed calls this news: its guid / Atom <id> / JSON Feed id, else its link
  "sourceIdType": "link",                          // 'link' | 'guid' | 'atom:id' | 'json:id'
  "time": 1760000000000                             // headline loading time, ms
}
```

**`read`** — an array of read (user-deleted) news items. The feed server does not remove its own
headlines, so without this list a deleted news item would return on every next load. The record is
matched by the identity of the news — its `sourceId`, or its `link` when the feed states no id —
so a mark survives both a feed edit and the server reissuing the news under another address.

```json
{
  "link": "https://habr.com/ru/news/…/",              // the address the news had when it was deleted
  "sourceId": "https://habr.com/ru/news/1",           // the identity the marker is matched by
  "sourceIdType": "link",                            // 'link' | 'guid' | 'atom:id' | 'json:id'
  "pubDate": "Tue, 01 Oct 2024 08:00:00 GMT",        // the list is cleaned by this field's age
  "time": 1760000000000                              // deletion moment, if pubDate is absent
}
```

**`feed_fetch_locks`** — which feeds are being read right now. Only the background writes it, and
only for the length of one read: it is what keeps an alarm and a "Refresh" from fetching the same
address twice.

```json
{
  "c0f4…": { "until": 1760000045000 } // feedId → the moment its read may still be running, ms
}
```

A ticket whose `until` has passed belongs to a read that never came back (the worker fell asleep,
the browser was closed), so it stops holding the feed: `store.tryLockFeed` drops such tickets and
so does `store.cleanup` (see “Implementation notes”).

**`settings`** — `{ "theme": "dark" | "light", "sound": true | false, "sound_file": "src/media/ceres.mp3", "sound_volume": 100, "show_message": false, "read_ttl_days": 7, "language": "ru", "first_feed_done": true, "font_scales": { "feeds": 1, "headlines": 1.2, "content": 1 }, "column_widths": { "feeds": 240, "headlines": 340 } }`. `sound` is the «Sound» checkbox: off, and an automatic load plays no signal. `font_scales` is the font size of every reader column: a multiplier from the ladder `0.85 / 1 / 1.2 / 1.45` (`store.FONT_SCALES`), chosen by the switcher in the head of that column. `column_widths` is the width in pixels of every column the mouse can size — the feed column and the headline column — each clamped to 160..900 px (`store.MIN_PANEL_WIDTH`, `store.MAX_PANEL_WIDTH`); the article column takes the width the other two leave in the window. `first_feed_done` is the feed screen's mark that a feed has already been added and its headlines have come: it is absent before the first successful add, is set once and never taken back (not even after the feeds are deleted), so the confirmation of a first add does not repeat on every saved row. A first run is an empty feed table with no such mark (`store.getFirstFeedDone` / `store.setFirstFeedDone`).

Other storage properties:

- The order in `items` is freshest-first (`store.sortItems`; for equal `time` the order is
  stabilized by the headline).
- Only headlines the user deleted personally (the delete icon in the reader and the clear icon in
  the middle panel head, for one feed or for all) get into `read`. A headline expired by `clean_timeout` is not written to `read`: its term
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
- The widths of the reader columns are cached the same way (`rss-reader:column-widths`): on top of
  `settings.column_widths`, so `src/columns-boot.js` can open every column at its remembered width
  without waiting for the asynchronous read.
- Deleting a feed also deletes its headlines (`store.deleteFeed`); they do not get into `read`:
  the feed was deleted wholesale, and on re-adding it the headlines are read anew.

## Page ↔ service worker messages

Pages write to storage themselves, while alarms and the badge belong to the background, so they
communicate like this:

| Message | From where | What the background does |
|---|---|---|
| `MSG_REFRESH_FEED` (`feedId`) | reader "Refresh" and the middle-column load icon (with one feed selected), settings screen "Load now" | reads the feed and saves the headlines; replies `{ok, added, skipped, seen, busy}`, where `skipped` is how many headlines were rejected as already read and `busy` says the feed is held by a read this request did not start, so it has no numbers of its own (the feed is not asked twice); no sound |
| `MSG_REFRESH_ALL_FEEDS` | reader "Refresh all": the middle-column load icon or the feeds-panel refresh icon, each with «Все ленты» selected | reads every feed of the list one after another, in the order of that list; replies `{ok, results, failed}`, where `results` is one `{feedId, ok, …}` per feed and `failed` counts the feeds that refused; a feed another context is already reading comes back with `busy` and is not counted as refused; no sound |
| `MSG_FEEDS_CHANGED` | reader (on opening), settings screen (after save/delete) | rebuilds alarms from the feed list, clears expired items, updates the badge |
| `MSG_COUNT` | not used by pages yet (reserved) | replies `{ok, count}` — the number of headlines in storage |
| `MSG_PLAY_SOUND` (`src`) | only `sound.playSound` from the background | the offscreen document plays the audio file selected on the settings screen from `src/media` |
| `MSG_FETCH_FEED` (`url`, `etag`, `lastModified`) | only the background (`background.readFeed`) | the offscreen document reads the feed conditionally and parses it, replies `{ok, result}` — where `result.notModified` says the server answered `304`, and `result.etag` / `result.lastModified` are the validators of the next read — or `{ok:false, error}` |

Additionally, pages and the background listen to `chrome.storage.onChanged`: a change in `feeds`
rebuilds alarms, a change in `items` updates the badge and the lists, a change in `settings`
(theme, `read_ttl_days`, the `sound` flag, the selected `sound_file`, `show_message`, `language`, the column sizes of `font_scales` or
the column widths of `column_widths`) runs the cleanup under the new rules, and the pages switch the
language of their labels — and the reader repaints the size or the width of the column that
changed, wherever that change came from. This is why the screens never “drift apart” from the
background.

## Limits and constants

| Constant | Value | Where |
|---|---|---|
| `MIN_ALARM_PERIOD_MINUTES` | 1 | `util.js` — the floor for `delay_timeout` |
| `CLEAN_PERIOD_MINUTES` | 1 | `util.js` — how often `clean_timeout` is checked |
| `DEFAULT_DELAY_TIMEOUT` | 30 min | `util.js` |
| `DEFAULT_CLEAN_TIMEOUT` | 1440 min (1 day) | `util.js` |
| `MAX_ITEMS_PER_FEED` | 250 | `util.js` — how many freshest headlines of one feed are stored |
| `MAX_ENTRIES` | 250 | `rss.js` — how many entries are taken from one feed response: the freshest by their date, whatever order the feed listed them in |
| `READ_TTL_DAYS` | 7 days | `util.js` — the **default value** for the “read” mark lifetime; configurable via the `read_ttl_days` field |
| `MIN_READ_TTL_DAYS` / `MAX_READ_TTL_DAYS` | 1 / 3650 | `util.js` — bounds of this field (`util.toDays`) |
| `MAX_READ_RECORDS` | 1000 | `util.js` — how many such marks are stored; the oldest are evicted first |
| `MAX_PREVIEW_CHARS` | 8000 | `util.js` — how much of a feed `<description>` a stored headline keeps |
| `PREVIEW_IMAGE_WIDTH` / `PREVIEW_IMAGE_HEIGHT` | 180 / 240 | `util.js` — the box given to every `<img>` a feed ships inside `<description>` |
| `MAX_PARAGRAPHS` / `MAX_CHARACTERS` | 60 / 16000 | `extract.js` — the limit of article text in the right panel |
| `MIN_PARAGRAPH_LENGTH` | 40 | `extract.js` — short lines (menus, captions) are not counted as article text |
| `ALARM_PREFIX` / `CLEANUP_ALARM_NAME` | `feed:<id>` / `rss-reader:cleanup` | `util.js` |
| `FEED_FETCH_TIMEOUT_MS` / `ARTICLE_FETCH_TIMEOUT_MS` | 15 s / 12 s | `util.js` — how long a feed read — and a page read for an icon or an article — is waited for before the request is aborted |
| `MAX_FEED_BACKOFF_MINUTES` | 1440 min (1 day) | `util.js` — the longest pause `feedBackoffMinutes` gives a feed that keeps failing |
| `FETCH_LOCK_TTL_MS` | 45 s | `storage.js` — how long a feed stays held by the read that started: one bounded fetch (`FEED_FETCH_TIMEOUT_MS`) plus room for the offscreen document being asked twice and for parsing and saving the headlines |
| `FEED_EXPORT_VERSION` | 1 | `storage.js` — the version of the feeds file the feed screen writes and reads; a file of another version is refused |

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
- **Duplicates**: a headline is identified by `uid = feedId + "|" + sourceId`, where `sourceId` is
  the RSS `<guid>` or the Atom `<id>` when the feed states one and its link otherwise — the link
  read through `util.linkKey`, which drops what a feed varies between its own polls: `http` and
  `https`, `www`, the port the protocol implies, a trailing slash, the `#…` fragment and the
  tracking parameters (`utm_…`, `gclid`, `fbclid`, …). Re-polling a feed neither spawns copies nor
  resets the storage term of an existing record, and a news whose address moved is still recognised
  as the news it already is.
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
  against the feed URL; up to 250 entries per response — the newest by `pubDate`, not the first 250
  the feed happened to print, so a feed that lists its news oldest first (a WordPress archive, a
  forum) still offers its fresh headlines. The RSS `guid` (an `isPermaLink="false"`
  one, above all) and the Atom `<id>` are kept as `sourceId` — the name the feed gives its news,
  which is what the dedup matches on.
- **The namespaced fields of an entry are read too**, by namespace URI and not by prefix
  (`rss.entryDate`, `rss.entryDescription`, `rss.entryImages`): the full text a WordPress feed ships in
  `content:encoded` wins over the excerpt in `<description>` (the Atom `<content>` over `<summary>`),
  because `util.capPreview` is what cuts it anyway; the pictures a media feed states in
  `media:thumbnail` / `media:content` become the `<img>` that leads the preview — a `<media:content>`
  of a video is left out, and elements a feed grouped inside `<media:group>` are reached where the
  direct children of `<item>` would find nothing; and the publication date of an RDF feed is its
  `dc:date` (`dcterms:issued` / `dcterms:modified` likewise) — without it an RDF entry reaches storage
  with no date, `util.itemTime` answers the load time, and `clean_timeout` counts from the poll that
  read the feed instead of from the publication.
  A `<media:content>` shares the local name of the Atom `<content>` and carries its address in an
  attribute instead of text: the two are told apart by their namespace, so a media feed keeps its text
  as well as its picture.
- **What the stored preview of a headline is made of** (`storage.makeItem`): the pictures a feed
  ships inside `<description>` are put in one box (`util.normalizePreviewImages`), and the pictures
  this reader cannot show are taken out before the text is capped — a `data:` picture is a whole
  article written as base64 inside the text of another one, and `extract.sanitizePreview` refuses a
  `src` that is not http(s): left standing, it eats the whole `MAX_PREVIEW_CHARS` of its headline and
  storage keeps the base64 instead of the news and the picture the news could have shown
  (`util.dropUnpreviewableImages`). Only then `util.capPreview` cuts, and it cuts at the edge of the
  markup the cut landed in: a tag cut in the middle leaves its attributes loose in the text as
  characters no renderer was meant to read, and a character reference cut in the middle prints as the
  letters it was written to escape.
- **An answer that is XML but not a feed is refused rather than read as an empty feed**: the root
  decides what the document is — `<rss>`, `<feed>` and `<rdf:RDF>` (whose local name is uppercase)
  are feeds even when they ship no headlines right now, while a well-formed error page in XHTML, a
  sitemap or an API's answer is not, and fails as `errors.feedNotFeed` so the feed is recorded broken
  and its backoff starts. A document under another root that does carry `<item>`/`<entry>` is read as
  the feed it behaves like. The element an XML processor leaves on a document it could not read is
  found by its local name over the whole tree (`anyTag`, i.e. `getElementsByTagNameNS('*', …)`), not by
  a CSS selector: Blink writes `parsererror` into a namespace of its own, where
  `querySelector('parsererror')` does not reach it — missed, an error page was stored as a healthy feed
  with no headlines, and the failing feed was never backed off.
- **JSON Feed is supported too** (`application/feed+json`, and the `application/json` many sites
  serve it under): the answer is read as the object it is — its `title` and its `items[]` — with no
  DOM involved, so its rules are held by `scripts/test.mjs`. An item's `url` (or its `id`, when it is
  itself an address) becomes the `link` resolved against the feed URL; `content_html` is kept
  verbatim like `<description>` is, while plain `content_text` becomes one paragraph with its markup
  characters escaped; the item's `image` and its image `attachments` become an `<img>` tag in front of
  that text — the only shape a preview picture of this reader takes — where an attachment the feed
  marks `in_feed`, one whose address the text already carries, and one that is no image (audio, video)
  are left out, and `title_text` becomes the alternative text; `date_published` (or `date_modified`)
  becomes `pubDate`; the item's `id` is
  kept as `sourceId` under the `json:id` type, so the dedup works over a JSON Feed exactly as it
  does over XML. Which format an answer is in is decided by the response type and, when it says
  nothing useful, by how the body opens: a body that opens with `{` is read as JSON even under
  `text/html`, and an ordinary RSS document served under `application/json` is still read as RSS. A
  JSON answer that turns out to be no feed fails as `errors.feedNotJson`.
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
  with `src` and a volume fraction), and the offscreen document resolves it via
  `chrome.runtime.getURL(src)` — the file
  lives inside the extension, so neither `web_accessible_resources` nor the network is needed for
  it. There is one player in the offscreen document and it is reused: the file loads once, a
  repeated signal interrupts the previous playback and starts from the beginning. The signal is
  switched and chosen on the global settings screen: the “Sound” checkbox writes its on/off flag
  to `settings.sound`, the combobox (a file from `src/media`) writes the file to
  `settings.sound_file`, and `playSound` (`src/lib/sound.js`) checks the flag first and does
  nothing when it is off. The volume slider to the right of the
  preview button writes its percent to `settings.sound_volume`; `playSound` turns it into a 0–1
  fraction in the same message and the preview plays the file at the slider value even before
  “Write”, while the offscreen player applies `player.volume` before every signal — a saved
  volume takes effect on the very next alert. The file list is fixed by the `SOUND_FILES`
  constant in `src/lib/storage.js` (ariel, carme, ceres, titan, …); an unknown path is normalized
  by storage to `DEFAULT_SOUND_FILE` (`src/media/ceres.mp3`), so the signal only ever plays from
  `src/media`. The same `settings.sound` key also carries the sound flag of builds that predate
  the checkbox: a stored `false` there (the old “No sound” row) keeps the alert silent, and a
  stored `"none"` file plays the default file instead — only the flag gates the sound now.
- **Load message** — when an automatic fetch brings headlines and “Show a message” is written on
  the settings screen, the worker shows a system popup (`chrome.notifications`, permission
  `notifications`) naming how many headlines came in. Its language is the interface language:
  `store.getLanguage()` puts the stored language into `i18n.t()`'s cache on its way out, and a
  worker with no localStorage access falls back to the browser language. The popup names itself
  with a unique id and clears itself after a few seconds; a manual “Refresh”/“Load now” shows no
  popup, exactly as it plays no sound.
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
  selects the “All feeds” row of the left column and the freshest headline of every feed it
  covers, which is immediately shown in the right panel. If the tab returned from a settings
  screen, the choice from `sessionStorage` outweighs auto-selection; but if the saved feed has
  meanwhile been deleted and its headline has expired by `clean_timeout`, the reader still selects
  “All feeds” and its freshest headline.
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
- **Conditional GET: the feed is asked whether it changed**: `ETag` and `Last-Modified` of the last
  read are stored on the feed and sent back as `If-None-Match` / `If-Modified-Since`. A server that
  answers `304` (or `204`) sends no body: `rss.js` returns it as `notModified` without decoding or
  parsing anything, and `ingestFeed` writes no headlines, so the read costs one empty response
  instead of the whole feed and cannot invent “new” headlines that are not new. `cache: 'no-store'`
  stays: the reader keeps its own validators, and Chrome's HTTP cache would only hold a second,
  invisible copy of the same answer. The details that make this safe: a weak validator (`W/"…"`)
  is not sent, since it promises meaning rather than the bytes a GET wants; `Last-Modified` is only
  kept when it really is an HTTP-date, because a validator the server cannot read often buys a 400;
  a `304` may carry a fresher `ETag` than the body it refused to send, so the keys are rewritten
  while `lastFetchedAt` — the age of the headlines those keys describe — is not; a server that
  stops sending validators is not asked with the old ones any more (the date its headlines arrived is
  not one of the keys and stays), and a `404` / `410` / `412` on a
  feed that had them makes the worker forget them, so one stubborn server cannot turn every poll
  into a failure. A read that fails does not lose its keys: the next poll still asks politely. And
  the keys are only asked with while the reader still holds the headlines they describe — once
  `clean_timeout` has purged a feed's headlines, the next read asks for the whole feed, so a polite
  `304` cannot leave the reader empty.
- **A feed that does not answer is waited for only so long, then left alone**: every request the
  reader makes carries an `AbortController` — `fetchFeed()` stops after `FEED_FETCH_TIMEOUT_MS`
  (15 s), `readPage()` (an icon, a feed's self-discovery) and `fetchArticle()` after
  `ARTICLE_FETCH_TIMEOUT_MS` (12 s). The timer is cleared only when the whole response — body
  included — is in hand, so a server that opens the connection and then goes silent cannot hold a
  poll open indefinitely; an abort is reported as `errors.feedTimeout` / `errors.articleTimeout`
  naming the seconds it waited. A feed that fails is then given a pause instead of being asked
  again every `delay_timeout`: `markFeedChecked()` stores `nextRetryAt` = now +
  `feedBackoffMinutes(fetchFailureCount, delay_timeout)`, which doubles the feed's own period for
  every failure in a row (1 failure → one period, 2 → two, 3 → four, …) and stops growing at
  `MAX_FEED_BACKOFF_MINUTES` (a day). The worker skips the alarm of a feed still in its pause, and
  the reader names the wait in the feed's health line, its tooltip and the worker log. Two things
  keep this from turning into a feed that never comes back: the alarms themselves are not moved —
  an extra alarm during a pause is only not answered, so a feed that recovers returns to its own
  schedule — and a read by hand (“Load now”, `r`) is an explicit order and is never refused, so a
  user can always force a paused feed to answer. A read that works deletes `nextRetryAt` and
  restarts the ladder from the beginning. Only a refusal *of the feed* starts the pause: a read that
  fails because the reader's own shelf would not take the headlines it just fetched
  (`storageFailure()` / `errors.storageUnavailable` in `src/background.js`), or because its helper
  page could not be opened, is recorded as the answer it really was — `markFeedChecked({ ok: true })`
  — so a feed that answered keeps its schedule, its keys and a healthy line on the settings screen.
- **One feed is read once**: a feed whose read is running is held, so the alarm of a feed and a
  “Refresh” of the same feed cannot fetch one address twice. The fast guard lives in the worker
  (`readingFeedIds` in `src/background.js`, checked synchronously — before any read from storage,
  so two requests cannot race over it): the second request does not fetch again, it waits for the
  read in progress and answers with its headlines, which is why “Refresh” pressed over a feed that
  is loading still reports something true instead of “0 headlines”. A read that fails gives its
  feed back in the same `finally` that raised the failure. The hold is written to
  `chrome.storage.local` as well (`store.tryLockFeed` / `store.releaseFeedLock`, the
  `feed_fetch_locks` key), because a service worker falls asleep at any moment and a guard kept only
  in its memory sleeps with it: the ticket survives the worker, an alarm queued behind it does not
  start a second fetch of the same feed. A ticket older than `FETCH_LOCK_TTL_MS` is a read that never
  came back, so it stops holding its feed — `tryLockFeed` drops such tickets as it looks, and
  `store.cleanup` prunes them once a minute; deleting a feed drops its ticket with it. When storage
  itself refuses to answer, the read still runs on the local guard alone: a feed locked by a storage
  failure would never be read at all. Only a live ticket of a read this request did not start answers
  `busy` — that request fetched nothing and has no numbers of its own, and the most such a ticket
  can cost its feed is `FETCH_LOCK_TTL_MS`.
- **A first run says what it is in its own words**: the card of an empty reader lies in the markup
  (`#start-card` in `src/index.html`), so `applyI18n()` re-glues its captions on a language change
  exactly like the captions of the rest of the screen, while `renderStartCard()` only decides whether
  it stands there at all: without feeds it takes precisely the place where the future list begins.
  Everything the reader takes off the screen before the first feed is hidden by a rule of the screen
  where it sits (`.panel-head [hidden]` and `.start-card[hidden]` in `src/styles/reader.css`): an
  author rule about `display` outweighs the browser's `[hidden]`, so `hidden` alone on a button whose
  own class names its `display` would hide nothing. The `settings.first_feed_done` mark lives in
  storage rather than in one tab: the feed screen reads it, so the confirmation of a first add comes
  once — no matter in which tab the feed was saved (the test
  `the reader greets a first run that has no feeds` keeps the markup, the script, the stylesheet,
  the storage and the seven dictionaries in step).
- **No third-party dependencies**: feed polling and parsing are done by `fetch` under
  `host_permissions: <all_urls>`, the manifest requires no RSS parsing library: XML is parsed
  by the built-in `DOMParser` — but exactly where it is allowed — and JSON Feed by `JSON.parse`.

## Validation

```bash
node scripts/test.mjs        # unit tests of pure functions (util.js, i18n.js, encoding.js, parts of
                             # storage.js and rss.js) and the guards over the screen markup: 118 tests
node scripts/make_icons.mjs  # regenerate the icons (no dependencies)
node scripts/check_icons.mjs # make sure the icons are correct
```

The tests do not cover `chrome.*` code (alarms, action, offscreen, messages) or XML parsing —
that is checked in the browser after loading the extension. JSON Feed parsing needs no DOM, so its
rules are covered by the tests.

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
8. Click the trash icon in the head of the middle panel while «All feeds» is selected → all
   headlines vanish from storage, the number in the header resets to zero, the icon badge empties.
   Select one feed and press it again → only that feed's headlines are removed. The feeds
   themselves remain.
9. Click the plugin icon twice → there is no second reader tab: Chrome activated the already open
   one (and its window). Same for a reader open in another window.
10. In the reader select a feed and a headline → the “Feed settings” icon → the settings open in
    this same tab → the reader icon → the same feed and headline are open again.
11. Open the reader in a new tab (feeds and headlines already exist) → the “All feeds” row is
    highlighted, in the middle panel the freshest headline of all the feeds is highlighted, its
    text is visible right away, without a click.
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
    headline load is accompanied by the chosen signal. Uncheck “Sound” → “Write” → the load is no
    longer voiced, while “Show a message” keeps working; check it back → the signal returns, and
    the popup is unaffected either way. Drag the volume slider → “Preview” sounds at the chosen
    volume right away, without “Write”; press “Write” → the automatic signal plays at that volume
    from its very next alert. Turn on “Show a message” → “Write” → the next automatic load shows
    a system popup “N new headlines loaded” in the interface language; turn it off → the popup is
    gone while the sound (if switched on) stays.
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
21. Press the RSS icon in the head of the middle panel while «All feeds» is selected → every feed
    of the list is re-read one after another, the icon spins while it works, the counter and the
    panels refresh, and no sound plays. A feed that answers nothing does not stop the others: they
    are read, and the middle panel says how many feeds failed. With a single feed selected, the same
    icon reads only that feed.
22. Click another feed in the left column → the middle panel stands on that feed's first (freshest)
    headline and its text is already open in the right panel; no second click is needed.
23. Click the “All feeds” row → the middle panel holds the headlines of every feed, freshest on
    top, each labelled with the name of its own feed; the cursor moves to the freshest of them. With
    “All feeds” selected, the load icon in the middle head (or the refresh icon at the top of the
    feeds panel) reads every feed at once; with a single feed selected those same icons read only
    that feed.
24. Type a word in the search field of the middle panel → only the headlines whose title or feed name
    contains it stay, in the same order, and the counter beside the panel name counts those; type a
    word nothing matches → both panels say that the search found nothing. Press `Esc` → the field is
    empty and the whole list is back. Select a feed, type a word, press the “Feed settings” icon and
    return to the reader → the same feed is open with the same word in the field.
25. Press `/`, then a few letters → the search filters as you type. Press `↓` / `↑` (or `j` / `k`) →
    the cursor moves through the headlines and the text in the right panel follows, the row staying in
    view; `Enter` opens the original of the open headline in a new tab; `d` deletes it and opens the
    next visible one; `r` re-reads the selected feed. None of these keys fires while the cursor stands
    in the search field, except the arrows. Every row the keyboard opens takes the focus, and a screen
    reader reads its name; the outcome of `r` is said out loud from the hidden status line («5 new
    headlines», «3 feeds could not be refreshed»).
26. Press `?` (or click the «?» icon in the reader header) → a window over the three columns lists every
    key above with what it does. While it stands, `j`, `d`, `r` and `/` do nothing to the headlines;
    `?` or `Esc` or the close icon or a click beside the card closes it, and the cursor returns to the
    «?» icon.
27. Add a feed whose address answers nothing (or disconnect the network) and wait for its period →
    in the left column a warning glyph stands beside its name, under the name the number of failures
    runs; its tooltip names the last check and the last failure in the interface language. On the
    feed screen the health line under the same feed now carries that failure with the number of
    failures in a row, and the planned next check; from the second failure in a row the same line and
    its tooltip add how much longer an automatic read leaves the feed alone, and the worker log says
    the feed is not asked again for that long. After a read that worked the glyph, the count and
    the failure on the settings line disappear, the counter is back to zero, the pause is over and the
    old failure is no longer shown. Change the feed's `rss_link` on the feed screen → the old failures
    are gone with the address they described.
28. Add a feed whose server answers with validators (`ETag` or `Last-Modified` — many news sites do)
    and open the service worker's console → the first read brings those answers, and `feeds` in
    `chrome.storage.local` grows `etag`, `lastModified` and `lastFetchedAt`. Press “Refresh” a minute
    later → the console says `nothing new (304)`, the headlines and the badge stay exactly as they
    were, and in the Network panel the request goes out with `If-None-Match` / `If-Modified-Since`
    and comes back with an empty body.
29. Add a feed whose address opens the connection but never answers it → after 15 seconds the read
    fails with “the feed did not answer within 15 seconds” instead of holding the poll open, and
    “Refresh all feeds” still gets through the rest of the feeds one by one.
30. Give a feed `delay_timeout: 1` and press the load button of its row on the feed screen the
    moment its alarm fires → the service worker console says `already being read, this request takes
    its answer`, the Network panel shows **one** request to that address, not two, the row reports
    its ordinary numbers, and the headlines appear once. A row answers `busy` (the console says
    `read by another request, this one is skipped`) only while a read of another context holds the
    feed; then the row simply stays at “Loading…”.
31. Open `chrome.storage.local` (`items`) and compare a headline's `link` with its `sourceId` →
    `sourceId` has no `utm_…`, no `www`, no trailing slash, while `link` is the address the feed
    wrote. On a feed that reissues the same news under another address (a `guid` with
    `isPermaLink="false"`, or a link that only grew tracking parameters) the list keeps **one**
    headline, `added 0` in the read's numbers; delete it and press “Refresh” → it does not come back
    while its read marker lives, and in `read` the marker carries the same `sourceId`.
32. On the feed screen press the export icon → a `rss-reader-feeds.json` downloads with the name, the
    link and both minute fields of every feed, and nothing else: no `id`, no `etag`, no health record.
    Open that file in another profile (or delete the feeds first) and press the import icon → the
    feeds appear in the table with the same name and minutes, each with a fresh `id`, the worker
    console shows their alarms, and their headlines load on their own period. Import the same file a
    second time → the line under the table says nothing was added, and the feeds, their headlines and
    any local name or minutes stay as they were. Hand it a file of another `version`, a file that is
    not JSON, or one with rows that fail the row check → the line says what was refused, and nothing
    in storage changed.

33. Open the reader on a feed that has been read → one line under the head of the middle column names
    when its headlines came in and when they are next asked for; on «All feeds» the age is the
    freshest of those feeds and the next check is the earliest of their alarms. Leave the tab open →
    «4 min ago» becomes «5 min ago» on its own. Press “Refresh” → the line answers without a reload,
    because a read rewrites the feed row and the reader repaints from it, and the moment it names is
    the number that stands in `feeds[].nextAlarmAt` in `chrome.storage.local`.
34. On the feed screen press Tab through the row of icons, a row of the table and the “?” → every one
    of them takes a visible outline, the “?” included, although it is a `<summary>` and no button. Press
    the “save” icon of a row whose link is empty → the row says “Check the fields” to the eye and the
    same words come from its hidden status line, which also names the table when a screen reader enters
    it. On the global settings screen press “Write” → what was written is read out loud, while the
    «changes are not written yet» hint stays where it stands. Turn on “reduce motion” in the OS → the
    colours of a button stop fading and the reader's refresh glyph stops spinning.
35. Delete every feed and open the reader again (or open it straight after the install) → the middle
    column is filled by the card “No feeds yet” with words about where the headlines and the news
    text will appear, and its button leads to the feed screen in the same tab; the search field and
    the load and clear buttons of that column are hidden, `/` takes the focus nowhere, and the right
    panel speaks about a first feed instead of “select a headline”. Save the first feed → the line
    “Feed added, its first headlines loaded” appears under the table, and the card disappears, giving
    its place back to the list. Save a second feed → no such line: the confirmation of a first add has
    already been given (`first_feed_done` in `settings`). Add a feed that cannot be read → nothing
    under the table, only the failure in the note of its own row.

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
