// The beta-tester survey: a one-week-in questionnaire that posts straight to my
// inbox through the SAME Web3Forms relay the feedback form uses (see feedback.ts)
// — no backend, no new dependency. Two entry points:
//   • a slim launch banner that appears once the app has been installed for a
//     week (maybeShowSurveyBanner, called on launch from main.ts), and
//   • the survey itself, a full page (openSurvey), also reachable from the
//     Settings "Beta survey" row.
//
// The survey opens as its own full-screen page. Every answer autosaves to a
// localStorage draft as it's made, so closing the app (or anything else) never
// loses progress — reopening restores exactly where you left off. On a
// successful submit the draft is cleared and SENT_KEY is set, so the banner
// never returns. Everything stays device-local apart from the single POST.

import { deviceLabel } from './feedback';
import { pushBack } from './back-nav';
import { Icons } from './icons';

const ACCESS_KEY = '07647d12-a144-4031-a14c-2c8cc3145650';
const ENDPOINT = 'https://api.web3forms.com/submit';
const INSTALL_KEY = 'obertura.installedAt';            // ms timestamp, set by main.ts
const SENT_KEY = 'obertura.survey.sent';               // '1' once submitted
const DISMISS_KEY = 'obertura.survey.dismissedSession'; // session-only flag
const DRAFT_KEY = 'obertura.survey.draft';             // JSON of in-progress answers
const DUE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
// Every question is a Field: the element to drop on the page, the value to send,
// whether it's been answered (for the progress bar), and serialize/restore for
// the autosaved draft. Free-text fields don't count toward progress (they're
// optional), so the bar reflects the choices and ratings.

interface Field {
  id: string;                 // payload key
  el: HTMLElement;
  counted: boolean;           // counts toward the progress bar
  value(): string | number;   // what gets sent
  answered(): boolean;
  serialize(): unknown;       // for the draft
  restore(v: unknown): void;  // from the draft
}

// An option is either a plain label or a label with a small emoji. The emoji is
// display-only — the value sent stays clean text.
type Opt = string | { v: string; e?: string };
interface NOpt { v: string; e?: string }
function normOpt(o: Opt): NOpt { return typeof o === 'string' ? { v: o } : o; }

// Lay the option cards in one or two columns, decided by the longest option so
// short answers pair up and long ones get a full row to themselves. A lone last
// card in a 2-column grid spans the full width (CSS), so 3-option questions stay
// balanced rather than leaving a gap.
function applyGrid(group: HTMLElement, opts: NOpt[]): void {
  const maxLen = Math.max(...opts.map((o) => o.v.length));
  const cols = maxLen > 22 ? 1 : 2;
  group.dataset.cols = String(cols);
  group.style.gridTemplateColumns = cols === 1 ? '1fr' : '1fr 1fr';
}

// A question label, with an optional sub-line beneath it.
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

// A section heading with an accent icon — these read as real titles.
function sectionHead(icon: SVGElement, title: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'survey-section-head';
  const badge = document.createElement('span');
  badge.className = 'survey-section-icon';
  badge.appendChild(icon);
  const t = document.createElement('h3');
  t.className = 'survey-section-title';
  t.textContent = title;
  h.append(badge, t);
  return h;
}

// Single-choice: option cards, one selected at a time. An "Other" option reveals
// a text field, and the typed text rides along in the sent value.
function buildSingle(id: string, label: string, opts: Opt[], onChange: () => void): Field {
  const norm = opts.map(normOpt);
  const wrap = document.createElement('div');
  wrap.className = 'survey-q';
  wrap.appendChild(questionLabel(label));

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
    id, el: wrap, counted: true,
    value() {
      if (selected === 'Other') {
        const t = otherInput.get();
        return t ? `Other: ${t}` : 'Other';
      }
      return selected;
    },
    answered: () => selected !== '',
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
function buildMulti(id: string, label: string, opts: Opt[], onChange: () => void): Field {
  const norm = opts.map(normOpt);
  const wrap = document.createElement('div');
  wrap.className = 'survey-q';
  wrap.appendChild(questionLabel(label));

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
    id, el: wrap, counted: true,
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
    answered: () => selected.size > 0,
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
    id, el: wrap, counted: true,
    value: () => rating,
    answered: () => rating > 0,
    serialize: () => rating,
    restore(v) { rating = Number(v) || 0; reflect(); },
  };
}

// A free-text answer (optional — doesn't count toward progress).
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
    id, el: wrap, counted: false,
    value: () => ta.value.trim(),
    answered: () => ta.value.trim() !== '',
    serialize: () => ta.value,
    restore(v) { ta.value = typeof v === 'string' ? v : ''; },
  };
}

// ── Survey page ──────────────────────────────────────────────────────────────
export function openSurvey(): void {
  if (document.querySelector('.survey-overlay')) return; // already open

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay edit-overlay--full survey-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet edit-sheet--full survey-page';

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // ── Header: back arrow, title, progress bar ──
  const header = document.createElement('div');
  header.className = 'survey-header';
  const headRow = document.createElement('div');
  headRow.className = 'survey-head-row';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'survey-back';
  backBtn.setAttribute('aria-label', 'Close survey');
  backBtn.appendChild(Icons.back(22));
  backBtn.addEventListener('click', close);
  const titleEl = document.createElement('h2');
  titleEl.className = 'survey-title';
  titleEl.textContent = 'Quick survey';
  headRow.append(backBtn, titleEl);
  header.appendChild(headRow);

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
  header.appendChild(prog);
  sheet.appendChild(header);

  // ── Scrolling body ──
  const body = document.createElement('div');
  body.className = 'survey-body';
  sheet.appendChild(body);

  const fields: Field[] = [];
  const onChange = () => { persistDraft(); updateProgress(); };
  const addSection = (icon: SVGElement, title: string) => body.appendChild(sectionHead(icon, title));
  const addQ = (f: Field) => { fields.push(f); body.appendChild(f.el); };
  const addNote = (text: string) => {
    const p = document.createElement('p');
    p.className = 'survey-intro';
    p.textContent = text;
    body.appendChild(p);
  };

  // Intro.
  const intro = document.createElement('div');
  intro.style.display = 'flex';
  intro.style.flexDirection = 'column';
  intro.style.gap = '0.6rem';
  const lead = document.createElement('p');
  lead.className = 'survey-intro survey-intro--lead';
  lead.textContent = 'Thanks for testing Obertura. 🙌';
  const i1 = document.createElement('p');
  i1.className = 'survey-intro';
  i1.textContent =
    "This survey takes about 4 minutes. I'm trying to understand whether Obertura " +
    "fits naturally into a player's weekly routine and whether it's worth growing " +
    'into something bigger.';
  const i2 = document.createElement('p');
  i2.className = 'survey-intro';
  i2.textContent = 'There are no wrong answers. Even "I barely used it" is valuable feedback.';
  const i3 = document.createElement('p');
  i3.className = 'survey-intro';
  i3.textContent = 'Your responses are sent directly to me by email. No other data is collected.';
  intro.append(lead, i1, i2, i3);
  body.appendChild(intro);

  // ── You & chess ──
  addSection(Icons.pawn(18), 'You & chess');
  addQ(buildSingle('q01_player_type', 'How would you describe yourself as a chess player?', [
    { v: 'Casual player', e: '🙂' },
    { v: 'Club player', e: '♟️' },
    { v: 'Tournament player', e: '🏆' },
  ], onChange));
  addQ(buildSingle('q02_play_online', 'How often do you play online?', [
    { v: 'Daily', e: '🔥' }, 'A few times a week', 'Occasionally', 'Rarely',
  ], onChange));
  addQ(buildText('q03_hardest_about_openings',
    "What's the hardest part of learning and remembering openings?", onChange,
    { placeholder: 'Move orders, the plans behind them, transpositions…' }));
  addQ(buildMulti('q04_other_apps', 'Which opening or training tools have you used before?', [
    'Lotus Chess', 'Chessbook', 'ChessReps', 'Aimchess', 'Chesstempo', 'RepertoLab', 'None', 'Other',
  ], onChange));

  // ── Your week with Obertura ──
  addSection(Icons.clock(18), 'Your week with Obertura');
  addQ(buildSingle('q05_frequency', 'How often did you use Obertura this week?', [
    { v: 'Most days', e: '🔥' }, 'A few times', 'Once or twice', { v: 'Almost never', e: '😴' },
  ], onChange));
  addQ(buildSingle('q06_lines_added', 'Roughly how many lines did you add?', [
    '0-5', '5-10', '10-20', { v: 'More than 20', e: '📈' },
  ], onChange));
  addQ(buildSingle('q07_best_add_method', 'How did you usually add new lines?', [
    'Manually on the board',
    { v: 'Browsing the opening library', e: '📚' },
    { v: 'Importing my games', e: '⬇️' },
    { v: 'Preparing against an opponent', e: '🎯' },
    { v: 'Building with the engine', e: '🤖' },
  ], onChange));
  addQ(buildSingle('q08_top_mode', 'Which training mode did you use most?', [
    { v: 'Due Queue', e: '⏳' }, { v: 'Quick Fixes', e: '🔧' }, { v: 'Time Attack', e: '⏱️' },
    { v: 'Fresh Lines', e: '🌱' }, { v: 'Trouble Spots', e: '⚠️' }, "I didn't train",
  ], onChange));

  // ── The learning experience ──
  addSection(Icons.bulb(18), 'The learning experience');
  addNote('Obertura is built around a simple cycle: build a line → play it → review it later.');
  addQ(buildSingle('q09_loop_made_sense', 'Did that workflow make sense?', [
    { v: 'Yes, immediately', e: '✅' }, 'It took a little while', { v: 'Not really', e: '🤔' },
  ], onChange));
  addQ(buildSingle('q10_training_useful', 'Did your training sessions feel useful?', [
    { v: 'Almost always', e: '🎯' }, 'Most of the time', 'About half the time', { v: 'Rarely', e: '😕' },
  ], onChange));
  addQ(buildMulti('q11_stopped_using', 'What, if anything, stopped you from using the app more?', [
    { v: 'Nothing, I used it as much as I wanted', e: '👍' },
    "I wasn't sure what to do next",
    'Adding lines took too much effort',
    'Training felt repetitive',
    { v: 'I lost interest', e: '😐' },
    { v: 'I ran into bugs', e: '🐛' },
    { v: "I didn't have time", e: '⏰' },
    'Other',
  ], onChange));

  // ── Future directions ──
  addSection(Icons.compass(18), 'Future directions');
  addQ(buildSingle('q12_curated_repertoires', 'Would you use ready-made repertoires as a starting point?', [
    { v: "Yes, that's how I'd begin", e: '📚' },
    'Maybe, alongside building my own',
    "No, I'd rather build everything myself",
  ], onChange));
  addQ(buildSingle('q13_browser_desktop', 'Would you use Obertura on a computer?', [
    { v: 'Yes, regularly', e: '💻' }, 'Sometimes', 'Probably not',
  ], onChange));
  addNote('Currently, your repertoire is stored only on this device.');
  addQ(buildSingle('q14_data_preference', 'Which option would you prefer?', [
    { v: 'Local-only, with manual export/import', e: '📱' },
    { v: 'Google Drive backup and sync', e: '☁️' },
    { v: 'An account that syncs across devices', e: '🔐' },
    'Other',
  ], onChange));
  addQ(buildSingle('q15_payment_preference', 'If Obertura became a paid product, what would feel most reasonable?', [
    { v: 'One-time purchase', e: '💰' },
    { v: 'Monthly subscription', e: '🔁' },
    { v: 'Free with ads', e: '📺' },
    { v: "I wouldn't pay", e: '🙅' },
    'Other',
  ], onChange));

  // ── Quality & improvements ──
  addSection(Icons.target(18), 'Quality & improvements');
  addQ(buildText('q16_bugs', 'Did you encounter any bugs or issues?', onChange,
    { placeholder: 'What went wrong, and where?' }));
  addQ(buildSingle('q17_top_feature', "What's the one feature you'd most like to see next?", [
    { v: 'Share lines with others (friends or chess club)', e: '🤝' },
    { v: 'Have my own account', e: '👤' },
    { v: 'Google Drive sync', e: '☁️' },
    { v: 'Curated puzzles based on positions from my repertoire', e: '🧩' },
    { v: 'Curated repertoires with explanations', e: '📖' },
    'Other',
  ], onChange));

  // ── The name ──
  addSection(Icons.sparkles(18), 'The name');
  addNote('How do you feel about these possible names?');
  addQ(buildStars('name_obertura', 'Obertura', onChange));
  addQ(buildStars('name_zugzwang', 'Zugzwang', onChange));
  addQ(buildStars('name_kaissa', 'Kaissa', onChange));
  addQ(buildStars('name_movely', 'Movely', onChange));
  addQ(buildStars('name_lumo', 'Lumo', onChange));
  addQ(buildText('name_other', "Is there another name you'd prefer? I'm always open to ideas!", onChange,
    { rows: 2, placeholder: 'Your suggestion…' }));

  // ── Optional contact, last ──
  addQ(buildText('contact', 'Your name or email (optional)', onChange,
    { rows: 2, sub: "If you'd like me to follow up.", placeholder: 'name@example.com' }));

  // ── Honeypot — present for bots, off-screen and inert for people (copied from
  // feedback.ts). Web3Forms rejects the submission if it comes back filled. ──
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'botcheck';
  honeypot.className = 'feedback-honeypot';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');
  body.appendChild(honeypot);

  // ── Footer: status line + the big send button ──
  const footer = document.createElement('div');
  footer.className = 'survey-footer';
  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'btn-primary survey-send';
  sendBtn.textContent = 'Send your answers';
  footer.append(status, sendBtn);
  sheet.appendChild(footer);

  // ── Progress + draft ──
  function updateProgress(): void {
    const counted = fields.filter((f) => f.counted);
    const done = counted.filter((f) => f.answered()).length;
    const pct = counted.length ? Math.round((done / counted.length) * 100) : 0;
    fill.style.width = `${pct}%`;
    progLabel.textContent = `${done} of ${counted.length} answered`;
  }
  function persistDraft(): void {
    const draft: Record<string, unknown> = {};
    for (const f of fields) draft[f.id] = f.serialize();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage full / blocked */ }
  }
  function restoreDraft(): void {
    let draft: Record<string, unknown> | null = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { draft = null; }
    if (!draft) return;
    for (const f of fields) if (f.id in draft) f.restore(draft[f.id]);
  }

  // Replace the page with a thank-you once the answers are safely sent.
  function renderThanks(): void {
    prog.hidden = true;
    body.innerHTML = '';
    footer.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'survey-thanks';
    const icon = document.createElement('div');
    icon.className = 'survey-thanks-icon';
    icon.appendChild(Icons.sparkles(48));
    const h = document.createElement('h3');
    h.className = 'survey-thanks-title';
    h.textContent = 'Thank you! 🎉';
    const p = document.createElement('p');
    p.className = 'survey-thanks-body';
    p.textContent =
      'Your answers are on their way. This genuinely helps shape where Obertura goes next.';
    wrap.append(icon, h, p);
    body.appendChild(wrap);
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn-primary survey-send';
    done.textContent = 'Done';
    done.addEventListener('click', close);
    footer.appendChild(done);
    done.focus();
  }

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    status.textContent = 'Sending…';

    const payload: Record<string, unknown> = {
      access_key: ACCESS_KEY,
      subject: 'Obertura survey response',
      from_name: 'Obertura survey',
      botcheck: honeypot.value, // honeypot — must stay empty for a real person
      app_version: __APP_VERSION__,
      device: deviceLabel(),
    };
    for (const f of fields) payload[f.id] = f.value();

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
        sendBtn.disabled = false;
      }
    } catch {
      status.textContent = 'Couldn’t send — you may be offline. Please try again.';
      sendBtn.disabled = false;
    }
  });

  // Bring back any in-progress answers, paint the bar, and mount.
  restoreDraft();
  updateProgress();
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  body.scrollTop = 0;
}
