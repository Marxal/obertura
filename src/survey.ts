// The beta-tester survey: a one-week-in questionnaire that posts straight to my
// inbox through the SAME Web3Forms relay the feedback form uses (see feedback.ts)
// — no backend, no new dependency. Two entry points:
//   • a slim launch banner that appears once the app has been installed for a
//     week (maybeShowSurveyBanner, called on launch from main.ts), and
//   • the survey itself, a full page (openSurvey), also reachable from the
//     Settings "Beta survey" row.
//
// The survey is a focused, one-question-at-a-time form on its own full-screen
// page: an intro, then a question per screen with Next / Back / Skip, then a
// thank-you. Every answer — and the current step — autosaves to a localStorage
// draft, so closing the app (or anything else) never loses progress; reopening
// resumes exactly where you left off. A successful submit clears the draft and
// sets SENT_KEY, so the banner never returns. Everything is device-local apart
// from the single POST.

import { deviceLabel } from './feedback';
import { pushBack } from './back-nav';
import { Icons } from './icons';
import { celebratePawn } from './confetti';

const ACCESS_KEY = '07647d12-a144-4031-a14c-2c8cc3145650';
const ENDPOINT = 'https://api.web3forms.com/submit';
const INSTALL_KEY = 'obertura.installedAt';            // ms timestamp, set by main.ts
const SENT_KEY = 'obertura.survey.sent';               // '1' once submitted
const DISMISS_KEY = 'obertura.survey.dismissedSession'; // session-only flag
const DRAFT_KEY = 'obertura.survey.draft';             // JSON of in-progress answers + step
const DUE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Dispatched by the thank-you screen's "Back to train" button; main.ts listens
// for it and shows the Train tab.
const GO_TO_TRAIN_EVENT = 'obertura:gototrain';

// ── Launch banner ──────────────────────────────────────────────────────────
// Shown on launch (from main.ts) once the install is a week old and the survey
// hasn't been answered. "Later" hides it for the session; submitting the survey
// sets SENT_KEY so it never shows again.
export function maybeShowSurveyBanner(): void {
  if (localStorage.getItem(SENT_KEY) === '1') return;          // answered — never again
  if (sessionStorage.getItem(DISMISS_KEY) === '1') return;     // dismissed this session
  const installedAt = Number(localStorage.getItem(INSTALL_KEY));
  if (!installedAt) return;                                     // no install date yet
  if (Date.now() - installedAt < DUE_AFTER_MS) return;         // not a week in yet
  if (document.querySelector('.survey-banner')) return;        // already showing

  const banner = document.createElement('div');
  banner.className = 'survey-banner';
  // Minimal inline styles so the banner works even before any CSS is added. It
  // floats just above the bottom tab bar, themed to the current palette.
  banner.style.position = 'fixed';
  banner.style.left = '12px';
  banner.style.right = '12px';
  banner.style.bottom = '72px';
  banner.style.background = 'var(--bg-card,#1d1813)';
  banner.style.color = 'var(--text,#f3ead7)';
  banner.style.border = '1px solid var(--border,#3a3026)';
  banner.style.borderRadius = '12px';
  banner.style.padding = '12px 14px';
  banner.style.zIndex = '60';
  banner.style.boxShadow = '0 8px 24px rgba(0,0,0,.4)';
  banner.style.fontFamily = 'inherit';
  banner.style.display = 'flex';
  banner.style.flexDirection = 'column';
  banner.style.gap = '10px';

  const text = document.createElement('div');
  text.textContent =
    "You've used Obertura for a week — mind answering a few questions? It really helps.";
  text.style.fontSize = '0.9rem';
  text.style.lineHeight = '1.35';

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.alignItems = 'center';
  row.style.justifyContent = 'flex-end';

  const laterBtn = document.createElement('button');
  laterBtn.type = 'button';
  laterBtn.textContent = 'Later';
  laterBtn.style.background = 'none';
  laterBtn.style.border = 'none';
  laterBtn.style.color = 'inherit';
  laterBtn.style.font = 'inherit';
  laterBtn.style.opacity = '0.7';
  laterBtn.style.padding = '8px 10px';
  laterBtn.style.cursor = 'pointer';
  laterBtn.addEventListener('click', () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    banner.remove();
  });

  const answerBtn = document.createElement('button');
  answerBtn.type = 'button';
  answerBtn.className = 'btn-primary';
  answerBtn.textContent = 'Answer (4 min)';
  answerBtn.addEventListener('click', () => {
    banner.remove();
    openSurvey();
  });

  row.append(laterBtn, answerBtn);
  banner.append(text, row);
  document.body.appendChild(banner);
}

// ── Field model ──────────────────────────────────────────────────────────────
// Each question is a Field: the element to show, the value to send, and
// serialize/restore for the autosaved draft.
interface Field {
  id: string;                 // payload key
  el: HTMLElement;
  value(): string | number;   // what gets sent
  serialize(): unknown;       // for the draft
  restore(v: unknown): void;  // from the draft
}

// An option is either a plain label or a label with a small emoji. The emoji is
// display-only — the value sent stays clean text.
type Opt = string | { v: string; e?: string };
interface NOpt { v: string; e?: string }
function normOpt(o: Opt): NOpt { return typeof o === 'string' ? { v: o } : o; }

// Two columns only for 2- or 4-option (and short) questions; everything else —
// including 3- and 5-option questions — gets a single column, so there's never a
// lone over-wide card.
function applyGrid(group: HTMLElement, opts: NOpt[]): void {
  const maxLen = Math.max(...opts.map((o) => o.v.length));
  const twoCol = (opts.length === 2 || opts.length === 4) && maxLen <= 22;
  group.style.gridTemplateColumns = twoCol ? '1fr 1fr' : '1fr';
}

// The question prompt, with an optional sub-line beneath it.
function questionLabel(text: string, sub?: string): HTMLElement {
  const wrap = document.createElement('div');
  const l = document.createElement('label');
  l.className = 'survey-q-label';
  l.textContent = text;
  wrap.appendChild(l);
  if (sub) {
    const s = document.createElement('p');
    s.className = 'survey-q-sub';
    s.textContent = sub;
    wrap.appendChild(s);
  }
  return wrap;
}

// One option card: an optional emoji then the label.
function optButton(o: NOpt): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'survey-opt';
  b.dataset.value = o.v;
  b.setAttribute('aria-pressed', 'false');
  if (o.e) {
    const em = document.createElement('span');
    em.className = 'survey-opt-emoji';
    em.textContent = o.e;
    em.setAttribute('aria-hidden', 'true');
    b.appendChild(em);
  }
  const t = document.createElement('span');
  t.textContent = o.v;
  b.appendChild(t);
  return b;
}

// The reveal-on-"Other" text input. Hidden until "Other" is chosen.
function makeOtherInput(onChange: () => void): { el: HTMLInputElement; get(): string; set(v: string): void } {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input survey-other-input';
  input.placeholder = 'Tell me more…';
  input.hidden = true;
  input.addEventListener('input', onChange);
  return { el: input, get: () => input.value.trim(), set: (v) => { input.value = v; } };
}

// Single-choice: option cards, one selected at a time. An "Other" option reveals
// a text field, and the typed text rides along in the sent value.
function buildSingle(id: string, label: string, opts: Opt[], onChange: () => void, sub?: string): Field {
  const norm = opts.map(normOpt);
  const wrap = document.createElement('div');
  wrap.className = 'survey-q';
  wrap.appendChild(questionLabel(label, sub));

  const group = document.createElement('div');
  group.className = 'survey-options';
  applyGrid(group, norm);
  group.setAttribute('role', 'group');

  const hasOther = norm.some((o) => o.v === 'Other');
  const otherInput = makeOtherInput(onChange);

  let selected = '';
  const buttons: HTMLButtonElement[] = [];
  const reflect = () => {
    for (const b of buttons) {
      const on = b.dataset.value === selected;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (hasOther) otherInput.el.hidden = selected !== 'Other';
  };
  for (const o of norm) {
    const b = optButton(o);
    b.addEventListener('click', () => { selected = o.v; reflect(); onChange(); });
    buttons.push(b);
    group.appendChild(b);
  }
  wrap.appendChild(group);
  if (hasOther) wrap.appendChild(otherInput.el);

  return {
    id, el: wrap,
    value() {
      if (selected === 'Other') {
        const t = otherInput.get();
        return t ? `Other: ${t}` : 'Other';
      }
      return selected;
    },
    serialize: () => ({ sel: selected, other: otherInput.get() }),
    restore(v) {
      const s = v as { sel?: string; other?: string } | null;
      if (!s) return;
      selected = s.sel ?? '';
      otherInput.set(s.other ?? '');
      reflect();
    },
  };
}

// Multi-choice: the same cards, several active at once; the chosen labels come
// back joined by "; ". "Other" works as in buildSingle.
function buildMulti(id: string, label: string, opts: Opt[], onChange: () => void, sub?: string): Field {
  const norm = opts.map(normOpt);
  const wrap = document.createElement('div');
  wrap.className = 'survey-q';
  wrap.appendChild(questionLabel(label, sub));

  const group = document.createElement('div');
  group.className = 'survey-options';
  applyGrid(group, norm);
  group.setAttribute('role', 'group');

  const hasOther = norm.some((o) => o.v === 'Other');
  const otherInput = makeOtherInput(onChange);

  const selected = new Set<string>();
  const buttons: HTMLButtonElement[] = [];
  const reflect = () => {
    for (const b of buttons) {
      const on = selected.has(b.dataset.value!);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (hasOther) otherInput.el.hidden = !selected.has('Other');
  };
  for (const o of norm) {
    const b = optButton(o);
    b.addEventListener('click', () => {
      if (selected.has(o.v)) selected.delete(o.v);
      else selected.add(o.v);
      reflect();
      onChange();
    });
    buttons.push(b);
    group.appendChild(b);
  }
  wrap.appendChild(group);
  if (hasOther) wrap.appendChild(otherInput.el);

  return {
    id, el: wrap,
    value() {
      return norm
        .filter((o) => selected.has(o.v))
        .map((o) => {
          if (o.v === 'Other') {
            const t = otherInput.get();
            return t ? `Other: ${t}` : 'Other';
          }
          return o.v;
        })
        .join('; ');
    },
    serialize: () => ({ set: [...selected], other: otherInput.get() }),
    restore(v) {
      const s = v as { set?: string[]; other?: string } | null;
      if (!s) return;
      selected.clear();
      for (const x of s.set ?? []) selected.add(x);
      otherInput.set(s.other ?? '');
      reflect();
    },
  };
}

// A five-star rating row — name on the left, stars on the right. value() is 0–5,
// where 0 means "not rated"; tapping the current rating clears it.
function buildStars(id: string, name: string, onChange: () => void): Field {
  const wrap = document.createElement('div');
  wrap.className = 'survey-name-row';
  const nameEl = document.createElement('span');
  nameEl.className = 'survey-name';
  nameEl.textContent = name;

  const row = document.createElement('div');
  row.className = 'survey-stars';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `Rate ${name}`);

  let rating = 0;
  const stars: HTMLButtonElement[] = [];
  const reflect = () => stars.forEach((s, i) => {
    const on = i < rating;
    s.textContent = on ? '★' : '☆';
    s.classList.toggle('survey-star--on', on);
    s.setAttribute('aria-pressed', String(on));
  });
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'survey-star';
    s.textContent = '☆';
    s.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
    s.addEventListener('click', () => { rating = rating === i ? 0 : i; reflect(); onChange(); });
    stars.push(s);
    row.appendChild(s);
  }
  reflect();
  wrap.append(nameEl, row);

  return {
    id, el: wrap,
    value: () => rating,
    serialize: () => rating,
    restore(v) { rating = Number(v) || 0; reflect(); },
  };
}

// A free-text answer.
function buildText(
  id: string,
  label: string,
  onChange: () => void,
  opts: { rows?: number; placeholder?: string; sub?: string } = {},
): Field {
  const wrap = document.createElement('div');
  wrap.className = 'survey-q';
  wrap.appendChild(questionLabel(label, opts.sub));
  const ta = document.createElement('textarea');
  ta.className = 'edit-input survey-text';
  ta.rows = opts.rows ?? 3;
  if (opts.placeholder) ta.placeholder = opts.placeholder;
  ta.addEventListener('input', onChange);
  wrap.appendChild(ta);
  return {
    id, el: wrap,
    value: () => ta.value.trim(),
    serialize: () => ta.value,
    restore(v) { ta.value = typeof v === 'string' ? v : ''; },
  };
}

// ── Steps ──────────────────────────────────────────────────────────────────
// A step is one screen: a big section header, an optional must-not-miss context
// callout, the field(s), and the fields it carries (for value/draft).
interface Step {
  el: HTMLElement;
  fields: Field[];
}

function sectionHeader(name: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'survey-step-section';
  h.textContent = name;
  return h;
}

function contextEl(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'survey-step-context';
  p.textContent = text;
  return p;
}

// A standard one-field question screen.
function oneFieldStep(section: string, field: Field, context?: string): Step {
  const el = document.createElement('div');
  el.className = 'survey-step';
  el.appendChild(sectionHeader(section));
  if (context) el.appendChild(contextEl(context));
  el.appendChild(field.el);
  return { el, fields: [field] };
}

// ── Survey page ──────────────────────────────────────────────────────────────
export function openSurvey(): void {
  if (document.querySelector('.survey-overlay')) return; // already open

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay edit-overlay--full survey-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet edit-sheet--full survey-page';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A subtle slide-and-fade as each screen arrives. Re-triggers on every render
  // because we animate the freshly-shown element directly (skipped if the user
  // prefers reduced motion).
  function animateIn(el: HTMLElement): void {
    if (reduceMotion) return;
    el.animate(
      [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    );
  }

  // ── Back-nav: a single armed layer that steps back one screen (or closes at
  // the intro / after submit), re-arming itself so every press is caught. ──
  let closed = false;
  let submitted = false;
  let removeBack: (() => void) | null = null;
  function armBack(): void {
    removeBack = pushBack(() => {
      removeBack = null;
      if (submitted || current <= 0) close();
      else { current -= 1; render(); persistDraft(); armBack(); }
    });
  }
  function close(): void {
    if (closed) return;
    closed = true;
    removeBack?.();
    removeBack = null;
    overlay.remove();
  }

  // ── Top bar ──
  const header = document.createElement('div');
  header.className = 'survey-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'survey-back';
  backBtn.setAttribute('aria-label', 'Back');
  backBtn.appendChild(Icons.back(22));
  backBtn.addEventListener('click', () => { if (submitted || current <= 0) close(); else { current -= 1; render(); persistDraft(); } });
  const prog = document.createElement('div');
  prog.className = 'survey-progress';
  const track = document.createElement('div');
  track.className = 'survey-progress-track';
  const fill = document.createElement('div');
  fill.className = 'survey-progress-fill';
  track.appendChild(fill);
  const progLabel = document.createElement('span');
  progLabel.className = 'survey-progress-label';
  prog.append(track, progLabel);
  header.append(backBtn, prog);
  sheet.appendChild(header);

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'survey-body';
  sheet.appendChild(body);

  // ── Footer (persistent controls; labels/visibility set per screen) ──
  const footer = document.createElement('div');
  footer.className = 'survey-footer';
  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'btn-primary survey-next';
  // A discreet Back sits beside Skip, for people who don't spot the top arrow.
  const footLinks = document.createElement('div');
  footLinks.className = 'survey-foot-links';
  const backInline = document.createElement('button');
  backInline.type = 'button';
  backInline.className = 'survey-skip';
  backInline.textContent = 'Back';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'survey-skip';
  skip.textContent = 'Skip';
  footLinks.append(backInline, skip);
  footer.append(status, primary, footLinks);
  sheet.appendChild(footer);

  // ── Build the fields, then the question steps ──
  const onChange = () => persistDraft();

  const allFields: Field[] = [];
  const qsteps: Step[] = [];
  const single = (id: string, label: string, opts: Opt[], sub?: string) => buildSingle(id, label, opts, onChange, sub);
  const multi = (id: string, label: string, opts: Opt[], sub?: string) => buildMulti(id, label, opts, onChange, sub);
  const PICK_MANY = 'You can choose more than one.';

  // You & chess
  qsteps.push(oneFieldStep('You & chess', single('q01_player_type', 'How would you describe yourself as a chess player?', [
    { v: 'Casual player', e: '🙂' }, { v: 'Club player', e: '♟️' }, { v: 'Tournament player', e: '🏆' },
  ])));
  qsteps.push(oneFieldStep('You & chess', single('q02_play_online', 'How often do you play online?', [
    { v: 'Daily', e: '🔥' }, { v: 'A few times a week', e: '📆' }, { v: 'Occasionally', e: '🤏' }, { v: 'Rarely', e: '🦥' },
  ])));
  qsteps.push(oneFieldStep('You & chess', single('q03_hardest_about_openings',
    "What's the hardest part of learning and remembering openings?", [
      { v: 'Choose where to stop building the line', e: '✂️' },
      { v: 'Understanding the why of each move', e: '🤔' },
      { v: 'Why study, if what I study never happens on the board', e: '🤷' },
      { v: 'Other', e: '💬' },
    ])));
  qsteps.push(oneFieldStep('You & chess', multi('q04_other_apps', 'Which opening or training tools have you used before?', [
    { v: 'Lotus Chess', e: '🪷' }, { v: 'Chessbook', e: '📘' }, { v: 'ChessReps', e: '🔁' }, { v: 'Aimchess', e: '🎯' },
    { v: 'Chesstempo', e: '⏱️' }, { v: 'RepertoLab', e: '🧪' }, { v: 'None', e: '🚫' }, { v: 'Other', e: '💬' },
  ], PICK_MANY)));

  // Your week with Obertura
  qsteps.push(oneFieldStep('Your week with Obertura', single('q05_frequency', 'How often did you use Obertura this week?', [
    { v: 'Most days', e: '🔥' }, { v: 'A few times', e: '🙂' }, { v: 'Once or twice', e: '🤏' }, { v: 'Almost never', e: '😴' },
  ])));
  qsteps.push(oneFieldStep('Your week with Obertura', single('q06_lines_added', 'Roughly how many lines did you add?', [
    { v: '0-5', e: '🌱' }, { v: '5-10', e: '📈' }, { v: '10-20', e: '💪' }, { v: 'More than 20', e: '🚀' },
  ])));
  qsteps.push(oneFieldStep('Your week with Obertura', single('q07_best_add_method', 'How did you usually add new lines?', [
    { v: 'Manually on the board', e: '✋' },
    { v: 'Browsing the opening library', e: '📚' },
    { v: 'Importing my games', e: '⬇️' },
    { v: 'Preparing against an opponent', e: '🎯' },
    { v: 'Building with the engine', e: '🤖' },
  ])));
  qsteps.push(oneFieldStep('Your week with Obertura', single('q08_top_mode', 'Which training mode did you use most?', [
    { v: 'Due Queue', e: '⏳' }, { v: 'Quick Fixes', e: '🔧' }, { v: 'Time Attack', e: '⏱️' },
    { v: 'Fresh Lines', e: '🌱' }, { v: 'Trouble Spots', e: '⚠️' }, { v: "I didn't train", e: '🙈' },
  ])));

  // The learning experience
  qsteps.push(oneFieldStep('The learning experience',
    single('q09_loop_made_sense', 'Did that workflow make sense?', [
      { v: 'Yes, immediately', e: '✅' }, { v: 'It took a little while', e: '🐢' }, { v: 'Not really', e: '🤔' },
    ]),
    'Obertura is built around a simple cycle: build a line → play it → review it later.'));
  qsteps.push(oneFieldStep('The learning experience', single('q10_training_useful', 'Did your training sessions feel useful?', [
    { v: 'Almost always', e: '🎯' }, { v: 'Most of the time', e: '👍' }, { v: 'About half the time', e: '⚖️' }, { v: 'Rarely', e: '😕' },
  ])));
  qsteps.push(oneFieldStep('The learning experience', multi('q11_stopped_using', 'What, if anything, stopped you from using the app more?', [
    { v: 'Nothing, I used it as much as I wanted', e: '👍' },
    { v: "I wasn't sure what to do next", e: '🤷' },
    { v: 'Adding lines took too much effort', e: '😮‍💨' },
    { v: 'Training felt repetitive', e: '🔁' },
    { v: 'I lost interest', e: '😐' },
    { v: 'I ran into bugs', e: '🐛' },
    { v: "I didn't have time", e: '⏰' },
    { v: 'Other', e: '💬' },
  ], PICK_MANY)));

  // Future directions
  qsteps.push(oneFieldStep('Future directions', single('q12_curated_repertoires', 'Would you use ready-made repertoires as a starting point?', [
    { v: "Yes, that's how I'd begin", e: '📚' },
    { v: 'Maybe, alongside building my own', e: '🤝' },
    { v: "No, I'd rather build everything myself", e: '🛠️' },
  ])));
  qsteps.push(oneFieldStep('Future directions', single('q13_browser_desktop', 'Would you use Obertura on a computer?', [
    { v: 'Yes, regularly', e: '💻' }, { v: 'Sometimes', e: '🙂' }, { v: 'Probably not', e: '🙅' },
  ])));
  qsteps.push(oneFieldStep('Future directions',
    single('q14_data_preference', 'Which option would you prefer?', [
      { v: 'Local-only, with manual export/import', e: '📱' },
      { v: 'Google Drive backup and sync', e: '☁️' },
      { v: 'An account that syncs across devices', e: '🔐' },
      { v: 'Other', e: '💬' },
    ]),
    'Currently, your repertoire is stored only on this device.'));
  qsteps.push(oneFieldStep('Future directions', single('q15_payment_preference', 'If Obertura became a paid product, what would feel most reasonable?', [
    { v: 'One-time purchase', e: '💰' },
    { v: 'Monthly subscription', e: '🔁' },
    { v: 'Free with ads', e: '📺' },
    { v: "I wouldn't pay", e: '🙅' },
    { v: 'Other', e: '💬' },
  ])));

  // Quality & improvements
  qsteps.push(oneFieldStep('Quality & improvements', buildText('q16_bugs', 'Did you encounter any bugs or issues?', onChange,
    { placeholder: 'What went wrong, and where?' })));
  qsteps.push(oneFieldStep('Quality & improvements', single('q17_top_feature', "What's the one feature you'd most like to see next?", [
    { v: 'Share lines with others (friends or chess club)', e: '🤝' },
    { v: 'Have my own account', e: '👤' },
    { v: 'Google Drive sync', e: '☁️' },
    { v: 'Curated puzzles based on positions from my repertoire', e: '🧩' },
    { v: 'Curated repertoires with explanations', e: '📖' },
    { v: 'Other', e: '💬' },
  ])));

  // The name — five ratings plus a free-text suggestion, all on one screen.
  {
    const el = document.createElement('div');
    el.className = 'survey-step';
    el.appendChild(sectionHeader('The name'));
    el.appendChild(questionLabel('How do you feel about these possible names?'));
    const fields: Field[] = [];
    for (const [id, name] of [
      ['name_obertura', 'Obertura'], ['name_zugzwang', 'Zugzwang'], ['name_kaissa', 'Kaissa'],
      ['name_movely', 'Movely'], ['name_lumo', 'Lumo'],
    ] as const) {
      const f = buildStars(id, name, onChange);
      fields.push(f);
      el.appendChild(f.el);
    }
    const other = buildText('name_other', "Is there another name you'd prefer? I'm always open to ideas!", onChange,
      { rows: 2, placeholder: 'Your suggestion…' });
    fields.push(other);
    el.appendChild(other.el);
    qsteps.push({ el, fields });
  }

  // Before you go — any other feedback, then optional contact.
  {
    const el = document.createElement('div');
    el.className = 'survey-step';
    el.appendChild(sectionHeader('Before you go'));
    const fields: Field[] = [];
    const fb = buildText('other_feedback', 'Is there any other feedback you’d like to leave?', onChange,
      { rows: 3, placeholder: 'Anything at all — what you loved, what annoyed you, an idea…' });
    fields.push(fb);
    el.appendChild(fb.el);
    const contact = buildText('contact', 'Your name or email (optional)', onChange,
      { rows: 2, sub: "If you'd like me to follow up.", placeholder: 'name@example.com' });
    fields.push(contact);
    el.appendChild(contact.el);
    qsteps.push({ el, fields });
  }

  for (const s of qsteps) allFields.push(...s.fields);

  // ── Intro screen ──
  const introEl = document.createElement('div');
  introEl.className = 'survey-intro-screen';
  const lead = document.createElement('p');
  lead.className = 'survey-intro-lead';
  lead.textContent = 'Thanks for testing Obertura 🙌';
  const text = document.createElement('p');
  text.className = 'survey-intro-text';
  text.textContent =
    "About 4 minutes, one question at a time. I want to see whether Obertura fits " +
    "into your week — and whether it's worth growing into something bigger. There " +
    'are no wrong answers, and you can skip anything.';
  const fine = document.createElement('p');
  fine.className = 'survey-intro-fine';
  fine.textContent = 'Your answers are emailed straight to me. Nothing else is collected.';
  introEl.append(lead, text, fine);

  // ── Honeypot — present for bots, off-screen and inert for people (copied from
  // feedback.ts). Web3Forms rejects the submission if it comes back filled. ──
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'botcheck';
  honeypot.className = 'feedback-honeypot';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');
  sheet.appendChild(honeypot);

  // ── Navigation state ──
  // current === 0 is the intro; 1..qsteps.length are the question screens.
  let current = 0;

  function updateProgress(): void {
    const total = qsteps.length;
    const pct = total ? Math.round((current / total) * 100) : 0;
    fill.style.width = `${pct}%`;
    progLabel.textContent = `${current} of ${total}`;
  }

  function render(): void {
    while (body.firstChild) body.removeChild(body.firstChild);
    status.textContent = '';
    const screen = current <= 0 ? introEl : qsteps[current - 1].el;
    body.appendChild(screen);
    if (current <= 0) {
      prog.style.visibility = 'hidden';
    } else {
      prog.style.visibility = 'visible';
      updateProgress();
    }
    const last = current === qsteps.length;
    primary.textContent = current <= 0 ? 'Start the survey' : last ? 'Send your answers' : 'Next';
    primary.disabled = false;
    footLinks.hidden = current <= 0;
    backInline.hidden = !(current > 1);
    skip.hidden = !(current > 0 && !last);
    body.scrollTop = 0;
    animateIn(screen);
  }

  primary.addEventListener('click', () => {
    if (current <= 0) { current = 1; render(); persistDraft(); return; }
    if (current === qsteps.length) { void submit(); return; }
    current += 1;
    render();
    persistDraft();
  });
  backInline.addEventListener('click', () => {
    if (current > 1) { current -= 1; render(); persistDraft(); }
  });
  skip.addEventListener('click', () => {
    if (current > 0 && current < qsteps.length) { current += 1; render(); persistDraft(); }
  });

  // ── Draft (answers + current step) ──
  function persistDraft(): void {
    const answers: Record<string, unknown> = {};
    for (const f of allFields) answers[f.id] = f.serialize();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ answers, step: current })); } catch { /* blocked */ }
  }
  function restoreDraft(): void {
    let draft: { answers?: Record<string, unknown>; step?: number } | null = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { draft = null; }
    if (!draft || typeof draft !== 'object') return;
    const answers = draft.answers ?? {};
    for (const f of allFields) if (f.id in answers) f.restore(answers[f.id]);
    if (typeof draft.step === 'number') current = Math.max(0, Math.min(draft.step, qsteps.length));
  }

  // ── Submit ──
  async function submit(): Promise<void> {
    primary.disabled = true;
    footLinks.hidden = true;
    status.textContent = 'Sending…';

    const payload: Record<string, unknown> = {
      access_key: ACCESS_KEY,
      subject: 'Obertura survey response',
      from_name: 'Obertura survey',
      botcheck: honeypot.value, // honeypot — must stay empty for a real person
      app_version: __APP_VERSION__,
      device: deviceLabel(),
    };
    for (const f of allFields) payload[f.id] = f.value();

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        localStorage.setItem(SENT_KEY, '1');
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
        renderThanks();
      } else {
        const reason = (data && (data.message as string)) || `HTTP ${res.status}`;
        status.textContent = `Couldn’t send — ${reason}. Please try again.`;
        primary.disabled = false;
        footLinks.hidden = false;
      }
    } catch {
      status.textContent = 'Couldn’t send — you may be offline. Please try again.';
      primary.disabled = false;
      footLinks.hidden = false;
    }
  }

  // ── Thank-you — the success-screen pixel pawn and "Back to train". ──
  function renderThanks(): void {
    submitted = true;
    prog.style.visibility = 'hidden';
    while (body.firstChild) body.removeChild(body.firstChild);
    while (footer.firstChild) footer.removeChild(footer.firstChild);

    const wrap = document.createElement('div');
    wrap.className = 'survey-thanks';
    wrap.appendChild(celebratePawn()); // same hopping pixel pawn as the training-finish screen
    const h = document.createElement('h2');
    h.className = 'survey-thanks-title';
    h.textContent = 'Thank you! 🎉';
    const p = document.createElement('p');
    p.className = 'survey-thanks-body';
    p.textContent = 'Your answers are on their way. This genuinely helps shape where Obertura goes next.';
    wrap.append(h, p);
    body.appendChild(wrap);
    animateIn(wrap);

    const backToTrain = document.createElement('button');
    backToTrain.type = 'button';
    backToTrain.className = 'btn-primary survey-next';
    backToTrain.textContent = 'Back to train';
    backToTrain.addEventListener('click', () => {
      close();
      window.dispatchEvent(new Event(GO_TO_TRAIN_EVENT));
    });
    footer.appendChild(backToTrain);
    backToTrain.focus();
  }

  // ── Mount: restore any draft, paint the right screen, arm back. ──
  restoreDraft();
  render();
  armBack();
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
