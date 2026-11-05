# Translating Bito Chess: the plan

Status: **Phases 0 to 4, 6 and 7 done (2026-11-05).** Every screen, starter pack note, trap and endgame
is in Catalan, Spanish and Swedish (`src/locales/`), reachable with `?lang=ca`, `?lang=es` and `?lang=sv`.
None is released. Marçal has read the first 949 keys of Catalan on a phone. The rest of the Catalan, all
the Spanish and all the Swedish are unread, including all of Phase 7. Of Phase 8, the landing page and
checkout are done, and the emails are written but not live. Still to do: Phase 5 (reading it), privacy and
terms, the emails, then release.

Testing it: add `?lang=xx` to the address for the fake language (it lasts for that tab,
and `?lang=` ends it). `npm run i18n:layout` is the automatic check.

## The decisions

- **Languages:** Catalan (`ca`), Spanish (`es`), Swedish (`sv`), alongside English.
- **Build the system once and generate all three together.** Nearly all the work is
  preparing the app, and that is the same for one language or three.
- **Release each language when it has been reviewed.** Marçal reviews all three. Ask
  a Swedish club player to look at the main screens as well, if one is available.
- **English stays the source.** New features ship in English and fall back to it
  sentence by sentence until translated.
- **Translation is by Claude Code.** No paid service, and no third party in the
  privacy policy.

Why all three: Spanish reaches the most new people (Spain ranks 36th for English in
EF's 2025 index, Sweden 8th). Catalan brings Marçal's own clubs and honest feedback.
Swedish adds warmth more than access. Don't leave Spanish behind just because it
isn't the personal one.

## How much there is

| Piece | Size | Notes |
|---|---|---|
| App text | 3,190 strings, 2,316 different, 13,700 words, in 144 files | `npm run i18n:scan`, 2026-11-04. Replaces a rougher count of 1,960; repeats like "Cancel" need one translation |
| Text with inserted values | 520 | Must become whole sentences with placeholders |
| Hand-written plurals | 113 | `n === 1 ? '' : 's'` and similar |
| Starter pack notes | about 7,400 words | English in `src/starter-packs.json`, translations in `src/locales/content/` |
| Traps and endgames | about 1,150 words | Traps as above. Endgame names and ideas are ordinary dictionary keys |
| Landing page copy | about 4,900 words | `docs/LANDING-COPY.md` is the source |
| Privacy and terms | about 4,600 words | Includes some markup in the count |
| Opening names | 10,765 names in 407 families | Top 100 families cover 93% |

Leave these in their original language: Lichess study titles, which come from
other people through a pasted link, and players' names.

Move notation needs no work. The default uses piece symbols, so there is no
Cf3 / Sf3 problem. The optional letter notation stays in English letters.

## How language is chosen

**In the app**

1. A choice the person made wins (`obertura.language`).
2. Otherwise, the phone decides: Catalan goes to Catalan, Swedish to Swedish, and any
   other language to English. It takes the first match in the browser's language list
   among the released languages.
3. **For now, Spanish phones from Spain start in Catalan.** We're going after the
   Catalan audience first, and many Catalans have their phone in Spanish. Other Spanish,
   such as Mexico's, gets Spanish once it's released and English until then. The rule is
   `BROWSER_REDIRECTS` in `src/language-choice.ts`: delete it when Spain should get
   Spanish. It looks only at the phone's main language, and does nothing until Catalan
   is released.

- Settings has a Language row, and first-run shows a small picker, so anyone sent to the
  wrong language can change it straight away. Their choice is saved and always wins.
- A choice follows the account, which the `obertura.` key prefix already does. A
  detected language is never stored, so it can't follow someone to another phone.
- Set `<html lang>` to the active language. Hyphenation and screen readers need it.
- Currency stays separate. `preferredCurrency()` in `src/pricing.ts` reads the
  phone's languages, not the app's language, and keeps doing so.
- Changing language reloads the app. The UI is built synchronously, and the sync
  code already reloads after applying a snapshot.

**On the landing page**

- Each language has its own address: `/`, `/ca/`, `/es/`, `/sv/`, with `hreflang`
  links between them and a visible switcher.
- **`/` redirects by language, using the same rule as the app** (including Spain's
  Spanish to Catalan for now). Marçal decided this on 2026-11-04, replacing a one-tap suggestion.
  Google advises against redirecting between language versions, so keep the risk small:
  only `/` redirects, never `/ca/`, `/es/` or `/sv/`, so every version stays reachable
  at its own address. Anyone with a saved choice isn't redirected, and picking English
  in the switcher saves that choice. Check in Search Console afterwards that all
  versions get indexed.
- A choice made on the landing page carries into the app, since `/` and `/app/` are
  the same site and share `localStorage`.

## How it's built

- **Dictionaries:** `src/locales/en.json`, `ca.json`, `es.json`, `sv.json`, with
  stable keys grouped by screen (`train.cap.title`).
- **One function:** `t('key', { n: 3 })`, with no translation library. Plurals use
  `Intl.PluralRules`, which is built into browsers. All four languages need only
  `one` and `other`, but use the real rule anyway.
- **Load one language only:** English is bundled, and the others load with a dynamic
  import. `src/boot.ts` is the entry point: it loads the language, then `main.ts`, so
  `t()` can stay synchronous and work in module-level constants.
  Each dictionary should be about 100 KB raw. Check that after the first batch.
- **Fallback per key:** a missing key shows English and never the key name.
- **Starter packs and traps:** `src/locales/content/<lang>.json`, loaded only when those lists open,
  and matched by each line's and trap's English name. The moves stay in the source. A selftest fails if
  a translated note names a different move, square or move number from the English.
  If `build-starter-packs.mjs` renames a line or changes a note, that selftest shows what to redo.
- **A pack line someone has already added keeps the language it was added in.** Its name and notes are
  saved with the line and become that person's own text.
- **Change tracking:** `src/locales/status.json` records, per language and key, a
  hash of the English it was translated from and whether it's `machine` or
  `reviewed`. If the English changes, that key is out of date and shows English
  until it's redone.
- **Whole sentences only:** never join translated fragments. Word order differs.
- **Things that compare text must stop:** `freeValues` in `src/pro-sheet.ts` is keyed
  by the English sentence, so it needs real keys. Search for others like it.
- **Dates and numbers:** `formatNumber()` and `appLocale()` in `i18n.ts`. English keeps following
  the device, and any other language writes them its own way. Currency stays with `pricing.ts`.
- **Text in `index.html`:** marked `data-i18n="key"`, or `data-i18n-label="key"` for an icon
  button's label, filled in by `language.ts`.
- **A chip or button inside a sentence:** `tParts()` keeps the sentence whole, with `{move}` where
  the chip goes, so each language can put it where it belongs.

## Layouts: how they stay unbroken

The risk is real. The CSS has 130 no-wrap rules and 72 that cut text with "…",
but only 7 wrap rules, and cut-off text fails silently. Spanish and Catalan usually
run longer than English, and Swedish has long compound words. Test rather than
assume.

1. **Fake language first.** A generated `xx` locale, about 40% longer with accented
   letters, runs before any translation. It exposes untranslated text and overflow.
2. **Automatic check.** Extend the `verify` skill's headless browser to visit every
   screen in each language at 360 and 412 px wide. It reports the screen and string
   for clipped text (`scrollWidth > clientWidth`), sideways scrolling, and buttons
   that overflow their container.
3. **Fix the layouts, not the words.** Let text wrap by default, use `overflow-wrap`
   and `hyphens: auto`, and keep buttons flexible. Test hyphenation on a real phone,
   because browser support varies by language.
4. **Length limits for the tight spots.** The bottom menu, small buttons and chips
   get a limit in the dictionary metadata. The review page warns when a translation
   goes over.
5. **A shorter word before a smaller font.** Don't shrink text to make it fit.
6. **Screenshot sheets per language.** A test can't judge what looks wrong. Marçal
   checks these and the real phone.
7. **The rule:** a language doesn't ship while the check fails.

## Getting the words right

**Before translating**

- Marçal's guide, `catalan-instructions-bito.md`, sets the voice, including 15 agreed sentences.
  Most of it carries to Spanish and Swedish. *Badada* and *cagada* are Catalan only.
- The form of address is `tu` in Catalan and Spanish, `du` in Swedish.
- Keep Bito's rule from English: show facts, don't explain the obvious.

**The glossary** (`src/locales/GLOSSARY.md`), read before every translation pass.
About 80 terms, approved first, because it's the highest-value review there is. It
also has a "never" list of Spanish-influenced phrasing and word-for-word English.

Starting proposals, all to be checked:

| English | Catalan | Spanish | Swedish |
|---|---|---|---|
| line | línia | línea | linje |
| repertoire | repertori | repertorio | repertoar |
| opening | obertura | apertura | öppning |
| check / castling | escac / enroc | jaque / enroque | schack / rockad |
| pawn | peó | peón | bonde |
| knight | cavall | caballo | springare |
| bishop | alfil | alfil | löpare |
| rook | torre | torre | torn |
| queen | dama | dama | dam |
| king | rei | rey | kung |

Still to settle: due, drill, new move, game review, blunder, missed win, time
pressure, Blunder detective, Which move, Full Access, founding member.

**Corrections teach the system.** "Players say X, not Y" goes in the glossary, so it
fixes every case and every later pass.

**Where to check terms:** real club and federation usage first, then Lichess's
Catalan and Swedish interfaces for comparison only (don't copy). For Catalan app
wording, Softcatalà's style guide and term list. TERMCAT's Cercaterm for general
terms; no TERMCAT chess vocabulary turned up, so check before relying on one.

## The review page

A private link that works on a phone, and that can be shared with a Swedish reviewer:

- Grouped by screen, with a screenshot of that screen.
- English beside the translation, editable in place, with a tick to mark reviewed.
- Warnings for length limits and out-of-date strings.
- A filter for "not reviewed yet".
- Claude reads the corrections back into the dictionaries, and turns repeated ones
  into glossary rules.

Build it as a published artifact with shared storage, and load the
`artifact-capabilities` skill first to confirm what's available.

**What to read closely:** first-run, Home, training, the Pro popup and Settings. Spot
check the rest. Nobody should read 25,000 words line by line, and the glossary is
what keeps the unread parts consistent.

## Outside the app's text

- **Landing page:** `docs/index.html` stays the only page anyone edits. The build generates `/ca/`,
  `/es/` and `/sv/` from it (`scripts/landing-pages.mjs`), with the translations in
  `src/locales/landing/<lang>.json`, keyed by the English. A selftest lists any English with no translation,
  any translation whose English has gone, and any move that doesn't match. Only released languages get an
  address, so a deploy changes nothing until release. `LANDING_PREVIEW=1` builds them all, for looking at.
- **Privacy and terms:** translate them, and get legal advice on which version
  governs. Not decided here.
- **Sign-in emails:** Supabase has one template per project. The language is saved at sign-up, and
  the wording and test steps are in `EMAIL-TEMPLATES.md`. **Untested, so test first.**
- **Checkout:** Stripe Checkout supports `es` and `sv` but not Catalan (checked
  against the API reference, 2026-11). Catalan users get `es` (`worker/checkout-locale.ts`), and
  anyone else follows the browser, as before.
- **Opening names:** second phase. A glossary rule (family plus "Variation", "Attack"
  and so on, with the word order per language) covers 93% from the top 100 families.
  Anything else stays English. Until then, all opening names stay English.
- **App store text and support replies:** not part of this plan.

## Order of work

Each phase can stop safely, because of the English fallback.

| Phase | Work | Done when |
|---|---|---|
| 0 ✅ | Declare a version, and re-run the string count | `v0.18` |
| 1 ✅ | `t()`, dictionaries, language choice, fake language, layout check | Fake language runs on the core screens with no change for English users. The layout check covers all of first run, starter packs, the builder tour, the import sheet, the Pro popup, a drill, the five tabs and Settings |
| 2 ✅ | Move the core screens to keys: first-run, Home, training, Pro popup, Settings | Selftests pass, screens look identical in English |
| 3 ✅ | Marçal approves voice and glossary | Glossary approved |
| 4 ✅ | Translate the core screens into all three | Layout check passes in all languages. The review page waits until there is a Swedish reviewer |
| 5 | Marçal reviews Catalan first, then Spanish, and shows a few club players | Catalan and Spanish visible behind a setting |
| 6 ✅ | The remaining screens, one or two rounds at a time | No untranslated text in the fake language, apart from names, opening names and what Phase 7 covers |
| 7 ✅ | Starter pack notes, traps, endgames | Written and checked by machine. Still to be sampled by a chess player |
| 8 | Landing ✅, checkout ✅, emails (written, `EMAIL-TEMPLATES.md`, not live), privacy and terms (not started) | Each language's full path works, landing to purchase |
| 9 | Release Catalan, then Spanish, then Swedish, each once reviewed. Phones in Spain's Spanish get Catalan from the first release. They can only switch to Spanish once it's released, so ideally release the two together | |
| 10 | Opening names | |

Moving 144 files to keys is the largest single change the app has had, so do it in
small rounds and don't mix it with features.

Not built yet: the review page, `status.json` change tracking and length limits in the dictionary. A selftest already fails if a translation loses a placeholder or keeps a key English
no longer has. The Language row and
the first-run picker exist but stay hidden until a second language is in
`RELEASED_LANGUAGES` (`src/language-choice.ts`), or under a `?lang=` preview.

## Rules once it's in (the first is in `CLAUDE.md`; the checks they mention aren't built yet)

- New visible text goes through `t()`. A selftest fails on a hard-coded string on a
  screen that's been converted.
- Features ship in English. Translate per release, not per commit: there were 32
  commits in the 30 days before this plan.
- One command before deploying lists what's missing or out of date per language.
- Landing copy still starts in `docs/LANDING-COPY.md`.
- A language with too much out-of-date text gets fixed before its next release.

## Questions to settle when starting

- The default book names ("My White lines", "My Black lines") are saved in each person's data, so
  they stay in English for now. Decide in Phase 4 whether new books get a translated name.

- Is the app calm enough to start? Translating text that's about to change is wasted
  work, and day-two retention (7 returns from 80 installs by 2026-11-03) may matter
  more first.
- Who are the first two or three Catalan club players to ask?
