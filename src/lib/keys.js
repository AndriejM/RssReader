// The reader answers to a key by where that key stands on the keyboard, not only by the character the
// current layout prints.
//
// `event.key` is the printed character. On the Russian layout the keys the reader names `j`, `k`, `r`,
// `m`, `d`, `u` print `о`, `л`, `к`, `ь`, `в`, `г`, and such a keyboard has no key printing `/` at all
// — so a handler of `event.key` goes silent for exactly the readers whose screen is Russian.
// `event.code` names the physical key (`KeyJ`, wherever it stands and whatever it prints), and the
// Cyrillic layouts put the Latin letters of the key list at the same places: `о` under `j`, `л` under
// `k`, `к` under `r`, `ь` under `m`, `в` under `d`, `г` under `u`, `.` under `/`.
//
// Both names are returned, the printed one first, so a key answers from its own glyph as well as from
// its place — which a layout that moves its letters (Dvorak, AZERTY) still needs. Only the letters and
// the `/` get a second name: `?` needs none, because where a layout does not put it on the `/` key it
// prints it from another one, and the printed name leads there.

/**
 * The names a pressed key answers to, in the order the reader should try them.
 *
 * @param {{ key?: string, code?: string, shiftKey?: boolean }} event
 * @returns {string[]}
 */
export function readerKeys(event) {
  const names = [event.key];
  const code = event.code ?? '';

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) names.push(letter[1].toLowerCase());

  /* The key list names the search field `/`; a Cyrillic layout puts its `.` on that same key. */
  if (code === 'Slash' && !event.shiftKey) names.push('/');

  return names;
}
