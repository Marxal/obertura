# Translating Bito Chess: the plan

Status: **Phases 0 and 1 done, Phase 2 under way (2026-11-04).** The system is in place
and English users see no change. The bottom menu, the Language row, "Where do you play?",
the recap of your games and the finish card use it so far. Still to do in Phase 2: the
import panel, starter pack picker and sign-up card, then Home, training, the Pro popup
and Settings. Refresh the counts with `npm run i18n:scan`, because the app changes quickly.

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
| Starter pack notes | about 7,400 words | `src/starter-packs.json`, shown during training |
| Traps and endgames | about 1,150 words | `src/traps.json`, `src/endgames.json` |
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
- **Change tracking:** `src/locales/status.json` records, per language and key, a
  hash of the English it was translated from and whether it's `machine` or
  `reviewed`. If the English changes, that key is out of date and shows English
  until it's redone.
- **Whole sentences only:** never join translated fragments. Word order differs.
- **Things that compare text must stop:** `freeValues` in `src/pro-sheet.ts` is keyed
  by the English sentence, so it needs real keys. Search for others like it.
- **Dates and numbers:** go through `Intl` with the active language. The app has 19
  `toLocale`/`Intl` uses to check.
- **Text in `index.html`:** marked `data-i18n="key"`, filled in by `language.ts`.

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

- Marçal rewrites about 15 real app sentences the way Bito should sound in Catalan.
  They set the voice.
- Choose the form of address. Proposed: `tu` in Catalan and Spanish, `du` in Swedish.
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

- **Landing page:** generate the language versions from one template and the
  dictionaries with a small build script. Today `docs/index.html` is a hand-copied
  mirror of `docs/LANDING-COPY.md`. Four hand-copied mirrors would mean every edit
  happens four times.
- **Privacy and terms:** translate them, and get legal advice on which version
  governs. Not decided here.
- **Sign-in emails:** Supabase has one template per project. Branching on user
  metadata should work, with the language saved at sign-up. **Untested, so test first.**
- **Checkout:** Stripe Checkout supports `es` and `sv` but not Catalan (checked
  against the API reference, 2026-11). Pass `es` for Catalan users.
  `worker/stripe-checkout.ts` sets no locale today, so it follows the browser.
- **Opening names:** second phase. A glossary rule (family plus "Variation", "Attack"
  and so on, with the word order per language) covers 93% from the top 100 families.
  Anything else stays English. Until then, all opening names stay English.
- **App store text and support replies:** not part of this plan.

## Order of work

Each phase can stop safely, because of the English fallback.

| Phase | Work | Done when |
|---|---|---|
| 0 ✅ | Declare a version, and re-run the string count | `v0.18` |
| 1 ✅ | `t()`, dictionaries, language choice, fake language, layout check | Fake language runs on the core screens with no change for English users. The layout check covers first run through to the finish card, the five tabs and Settings; Phase 2 adds training and the Pro popup |
| 2 | Move the core screens to keys: first-run, Home, training, Pro popup, Settings | Selftests pass, screens look identical in English |
| 3 | Marçal approves voice and glossary | Glossary approved |
| 4 | Translate the core screens into all three, build the review page | Layout check passes in all languages |
| 5 | Marçal reviews Catalan first, then Spanish, and shows a few club players | Catalan and Spanish visible behind a setting |
| 6 | The remaining screens, one or two rounds at a time | No untranslated text in the fake language |
| 7 | Starter pack notes, traps, endgames | Reviewed by sampling |
| 8 | Landing, privacy, terms, emails, checkout | Each language's full path works, landing to purchase |
| 9 | Release Catalan, then Spanish, then Swedish, each once reviewed. Phones in Spain's Spanish get Catalan from the first release. They can only switch to Spanish once it's released, so ideally release the two together | |
| 10 | Opening names | |

Moving 144 files to keys is the largest single change the app has had, so do it in
small rounds and don't mix it with features.

Not built yet, because nothing needs them before Phase 4: `status.json` change tracking,
length limits in the dictionary, and the first three locale files. The Language row and
the first-run picker exist but stay hidden until a second language is in
`RELEASED_LANGUAGES` (`src/language-choice.ts`), or under a `?lang=` preview.

## Rules once it's in (add these to `CLAUDE.md`)

- New visible text goes through `t()`. A selftest fails on a hard-coded string on a
  screen that's been converted.
- Features ship in English. Translate per release, not per commit: there were 32
  commits in the 30 days before this plan.
- One command before deploying lists what's missing or out of date per language.
- Landing copy still starts in `docs/LANDING-COPY.md`.
- A language with too much out-of-date text gets fixed before its next release.

## Questions to settle when starting

- Is the app calm enough to start? Translating text that's about to change is wasted
  work, and day-two retention (7 returns from 80 installs by 2026-11-03) may matter
  more first.
- Keep "Bito" and "Full Access" in English, or translate "Full Access"?
- Who are the first two or three Catalan club players to ask?
