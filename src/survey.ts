// The beta-tester survey: a one-week-in questionnaire that posts straight to my
// inbox through the SAME Web3Forms relay the feedback form uses (see feedback.ts)
// — no backend, no new dependency. Two entry points:
//   • a slim launch banner that appears once the app has been installed for a
//     week (maybeShowSurveyBanner, called on launch from main.ts), and
//   • the survey bottom sheet itself (openSurveySheet, also reachable from the
//     Settings "Beta survey" row).
// Once a response is submitted the banner never returns. Everything stays
// device-local apart from the single POST to Web3Forms.

import { deviceLabel } from './feedback';
import { pushBack } from './back-nav';

const ACCESS_KEY = '07647d12-a144-4031-a14c-2c8cc3145650';
const ENDPOINT = 'https://api.web3forms.com/submit';
const INSTALL_KEY = 'obertura.installedAt';            // ms timestamp, set by main.ts
const SENT_KEY = 'obertura.survey.sent';               // '1' once submitted
const DISMISS_KEY = 'obertura.survey.dismissedSession'; // session-only flag
const DUE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// ── Launch banner ──────────────────────────────────────────────────────────
// Shown on launch (from main.ts) once the install is a week old and the survey
// hasn't been answered. Dismissing it with "Later" hides it for the session;
// submitting the survey sets SENT_KEY so it never shows again.
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
  // floats just above the bottom tab bar, out of the way of the board.
  banner.style.position = 'fixed';
  banner.style.left = '12px';
  banner.style.right = '12px';
  banner.style.bottom = '72px';
  banner.style.background = 'var(--card,#1d1813)';
  banner.style.color = 'var(--ink,#f3ead7)';
  banner.style.border = '1px solid var(--line,#3a3026)';
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
    openSurveySheet();
  });

  row.append(laterBtn, answerBtn);
  banner.append(text, row);
  document.body.appendChild(banner);
}

// ── Field builders ───────────────────────────────────────────────────────────
// Small local helpers so the question wiring isn't repeated. Each returns the
// element to drop in the sheet plus a get() that reads the current answer; no
// field is required, so an untouched control simply reports an empty value.

interface Field<T = string> {
  el: HTMLElement;
  get(): T;
}

// A labelled wrapper shared by every builder: an edit-label above the control.
function fieldWrap(labelText: string): { wrap: HTMLElement } {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.className = 'edit-label';
  label.textContent = labelText;
  wrap.appendChild(label);
  return { wrap };
}

// Single-choice: a full-width segmented control (the --full variant wraps long
// labels rather than clipping them), one value selected at a time. Mirrors the
// feedback.ts chip toggling — 'active' + aria-pressed on the chosen button.
function buildSingle(labelText: string, options: string[]): Field<string> {
  const { wrap } = fieldWrap(labelText);
  const group = document.createElement('div');
  group.className = 'seg-control seg-control--full';
  group.setAttribute('role', 'group');

  let selected = '';
  const buttons: HTMLButtonElement[] = [];
  const reflect = () => {
    for (const b of buttons) {
      const on = b.dataset.value === selected;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.value = opt;
    b.textContent = opt;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { selected = opt; reflect(); });
    buttons.push(b);
    group.appendChild(b);
  }
  wrap.appendChild(group);
  return { el: wrap, get: () => selected };
}

// Multi-choice: the same look, but several buttons can be active at once. The
// chosen labels come back joined by "; ".
function buildMulti(labelText: string, options: string[]): Field<string> {
  const { wrap } = fieldWrap(labelText);
  const group = document.createElement('div');
  group.className = 'seg-control seg-control--full';
  group.setAttribute('role', 'group');

  const selected = new Set<string>();
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.value = opt;
    b.textContent = opt;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (selected.has(opt)) selected.delete(opt);
      else selected.add(opt);
      const on = selected.has(opt);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    group.appendChild(b);
  }
  wrap.appendChild(group);
  return { el: wrap, get: () => [...selected].join('; ') };
}

// A five-star rating row. get() returns 0–5, where 0 means "not rated". Tapping
// the current rating again clears it back to 0.
function buildStars(labelText: string): Field<number> {
  const { wrap } = fieldWrap(labelText);
  const row = document.createElement('div');
  row.className = 'survey-stars';
  row.setAttribute('role', 'group');
  row.style.display = 'flex';
  row.style.gap = '4px';

  let rating = 0;
  const stars: HTMLButtonElement[] = [];
  const reflect = () => {
    stars.forEach((s, i) => {
      const filled = i < rating;
      s.textContent = filled ? '★' : '☆';
      s.setAttribute('aria-pressed', String(filled));
    });
  };
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'survey-star';
    s.textContent = '☆';
    s.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
    // Minimal inline styling so the stars read as stars without any new CSS.
    s.style.background = 'none';
    s.style.border = 'none';
    s.style.padding = '2px';
    s.style.fontSize = '1.5rem';
    s.style.lineHeight = '1';
    s.style.color = 'var(--accent)';
    s.style.cursor = 'pointer';
    s.addEventListener('click', () => {
      rating = rating === i ? 0 : i;
      reflect();
    });
    stars.push(s);
    row.appendChild(s);
  }
  wrap.appendChild(row);
  return { el: wrap, get: () => rating };
}

// A free-text answer: a short textarea, trimmed on read.
function buildText(labelText: string, rows = 3): Field<string> {
  const { wrap } = fieldWrap(labelText);
  const ta = document.createElement('textarea');
  ta.className = 'edit-input';
  ta.rows = rows;
  wrap.appendChild(ta);
  return { el: wrap, get: () => ta.value.trim() };
}

// A visual-only group sub-heading. Reuses edit-label, nudged a little larger and
// spaced from the field above so the sections read as groups.
function subheading(text: string): HTMLElement {
  const h = document.createElement('label');
  h.className = 'edit-label';
  h.textContent = text;
  h.style.marginTop = '0.6rem';
  h.style.fontSize = '0.95rem';
  h.style.color = 'var(--text)';
  return h;
}

// ── Survey sheet ─────────────────────────────────────────────────────────────
// Built exactly like openFeedbackSheet(): an edit-overlay holding an edit-sheet,
// the keyboard-inset lift, a back-gesture close, click-outside to dismiss, and
// the same Web3Forms POST on send.
export function openSurveySheet(): void {
  // ── Shell ──
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet survey-sheet';

  // Lift the sheet above the on-screen keyboard while a field is focused, so the
  // Send button stays reachable (mirrors feedback.ts).
  const vv = window.visualViewport;
  function syncKeyboardInset(): void {
    if (!vv) return;
    overlay.style.paddingBottom = `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`;
  }
  vv?.addEventListener('resize', syncKeyboardInset);
  vv?.addEventListener('scroll', syncKeyboardInset);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    vv?.removeEventListener('resize', syncKeyboardInset);
    vv?.removeEventListener('scroll', syncKeyboardInset);
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Quick survey';
  sheet.appendChild(title);

  const intro = document.createElement('p');
  intro.className = 'section-desc';
  intro.textContent =
    "Thanks for testing Obertura. About 4 minutes. I'm trying to learn whether " +
    "the app fits a real week, and whether it's worth growing into something " +
    "bigger — there are no wrong answers, and 'I didn't use it much' is useful " +
    'too. Your answers go straight to me by email; nothing else is collected.';
  sheet.appendChild(intro);

  // ── You & chess ──
  const q01 = buildSingle('How serious a player are you?', ['Casual', 'Club', 'Tournament']);
  const q02 = buildSingle('How often do you play online?',
    ['Daily', 'A few times a week', 'Occasionally', 'Rarely']);
  const q03 = buildText('What is the most challenging part of learning openings for you?');
  const q04 = buildMulti('Have you used other opening/training apps?',
    ['Lotus Chess', 'Chessbook', 'ChessReps', 'Aimchess', 'Chesstempo', 'RepertoLab', 'None', 'Other']);

  // ── Your week with Obertura ──
  const q05 = buildSingle('How often did you open the app this week?',
    ['Most days', 'A few times', 'Once or twice', 'Almost never']);
  const q06 = buildSingle('Roughly how many lines did you add?',
    ['0', '1–2', '3–5', '6–10', 'More than 10']);
  const q07 = buildSingle('Which way of adding lines worked best for you?',
    ['Building on the board', 'The opening library', 'From my imported games', 'Scouting an opponent', 'I only tried one']);
  const q08 = buildSingle('Which training mode did you use most?',
    ['Due queue', 'Quick fixes', 'Time attack', 'Fresh lines', 'Trouble spots', "I didn't train"]);

  // ── Does it work ──
  const q09 = buildSingle('The flow is: build a line → play it once → drill it later. Did that make sense?',
    ['Yes, immediately', 'Eventually', 'Not really']);
  const q10 = buildSingle('Did training ever feel repetitive or random rather than useful?',
    ['Always felt purposeful', 'Mostly', 'Sometimes felt random', 'Often felt random']);
  const q11 = buildMulti('What, if anything, made you put it down?',
    ['Nothing, I kept going', 'Got confused', 'Too much effort to add lines', 'Training felt like a chore', 'Lost interest', 'A bug', 'Other']);

  // ── Where it could go ──
  const q12 = buildSingle('Would you like curated, ready-made repertoires to start from?',
    ["Yes, I'd use those first", 'Maybe, alongside building my own', 'No, I prefer building my own']);
  const q13 = buildSingle('Would you want to use Obertura on a computer in the browser?',
    ['Yes, regularly', 'Sometimes', 'Not at all']);
  const q14 = buildSingle('Right now your data lives only on this device — no cloud lock-in, but it is tied to this phone. What fits you?',
    ['Fine, as long as I can export/import manually', "I'd want Google Drive sync & backup", "I'd want an account to use it on any device", 'Other']);
  const q15 = buildSingle('If you paid for Obertura, what would you prefer?',
    ['Pay once, own it forever', 'Monthly subscription', 'Free with ads', "I wouldn't pay", 'Other']);

  // ── Quality & wishes ──
  const q16 = buildText('Did you hit any bugs?');
  const q17 = buildText('Any feature you would want to see?');

  // ── The name ──
  const nameObertura = buildStars('Obertura');
  const nameZugzwang = buildStars('Zugzwang');
  const nameKaissa = buildStars('Kaissa');
  const nameMovely = buildStars('Movely');
  const nameLumo = buildStars('Lumo');
  const nameOther = buildText('A name we have not listed?', 2);

  // ── Optional, last ──
  const contact = buildText('Your name or email, if you want me to follow up', 2);

  // Lay everything out in order, with the section sub-headings between groups.
  sheet.append(
    subheading('You & chess'), q01.el, q02.el, q03.el, q04.el,
    subheading('Your week with Obertura'), q05.el, q06.el, q07.el, q08.el,
    subheading('Does it work'), q09.el, q10.el, q11.el,
    subheading('Where it could go'), q12.el, q13.el, q14.el, q15.el,
    subheading('Quality & wishes'), q16.el, q17.el,
    subheading('The name'), subheading('Rate each possible app name'),
    nameObertura.el, nameZugzwang.el, nameKaissa.el, nameMovely.el, nameLumo.el, nameOther.el,
    contact.el,
  );

  // ── Honeypot — hidden from people, tempting to bots. Web3Forms rejects the
  // submission if its `botcheck` field comes back filled (copied from feedback.ts). ──
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'botcheck';
  honeypot.className = 'feedback-honeypot';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');
  sheet.appendChild(honeypot);

  // ── Status line — success and failure both land here, clearly. ──
  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');

  // ── Actions ──
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'btn-primary';
  sendBtn.textContent = 'Send';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Close';
  cancelBtn.addEventListener('click', close);

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    cancelBtn.disabled = true;
    status.textContent = 'Sending…';

    const payload: Record<string, unknown> = {
      access_key: ACCESS_KEY,
      subject: 'Obertura survey response',
      from_name: 'Obertura survey',
      botcheck: honeypot.value, // honeypot — must stay empty for a real person
      app_version: __APP_VERSION__,
      device: deviceLabel(),
      q01_seriousness: q01.get(),
      q02_play_online: q02.get(),
      q03_hardest_about_openings: q03.get(),
      q04_other_apps: q04.get(),
      q05_frequency: q05.get(),
      q06_lines_added: q06.get(),
      q07_best_add_method: q07.get(),
      q08_top_mode: q08.get(),
      q09_loop_made_sense: q09.get(),
      q10_training_felt: q10.get(),
      q11_put_down: q11.get(),
      q12_curated_repertoires: q12.get(),
      q13_browser_desktop: q13.get(),
      q14_data_preference: q14.get(),
      q15_payment_preference: q15.get(),
      q16_bugs: q16.get(),
      q17_wishes: q17.get(),
      name_obertura: nameObertura.get(),
      name_zugzwang: nameZugzwang.get(),
      name_kaissa: nameKaissa.get(),
      name_movely: nameMovely.get(),
      name_lumo: nameLumo.get(),
      name_other: nameOther.get(),
      contact: contact.get(),
    };

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Never ask again, then collapse to a clean confirmation.
        localStorage.setItem(SENT_KEY, '1');
        sheet.innerHTML = '';
        const ok = document.createElement('h3');
        ok.className = 'edit-sheet-title';
        ok.textContent = 'Thanks ✓';
        const body = document.createElement('p');
        body.className = 'section-desc';
        body.textContent =
          'Your answers are on their way. This really helps shape where Obertura goes next — thank you.';
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'btn-primary';
        done.textContent = 'Done';
        done.addEventListener('click', close);
        sheet.append(ok, body, done);
        done.focus();
      } else {
        const reason = (data && (data.message as string)) || `HTTP ${res.status}`;
        status.textContent = `Couldn’t send — ${reason}. Please try again.`;
        sendBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    } catch {
      status.textContent = 'Couldn’t send — you may be offline. Please try again.';
      sendBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';
  btnRow.append(sendBtn, cancelBtn);
  sheet.appendChild(btnRow);
  sheet.appendChild(status);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
