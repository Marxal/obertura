// The in-app feedback form. Opens as a bottom sheet from Settings and posts
// straight to Web3Forms — a no-backend form relay — so messages land in my inbox
// without any server of our own. The access key below is PUBLIC by design:
// Web3Forms keys are meant to live in client code, and the destination email is
// configured on their dashboard, so it never appears here. (No email address of
// mine is ever shown in the UI.)

import { pushBack } from './back-nav';

const ACCESS_KEY = '07647d12-a144-4031-a14c-2c8cc3145650';
const ENDPOINT = 'https://api.web3forms.com/submit';

type Category = 'Bug' | 'Idea' | 'Other';

// A coarse device label for triage — platform and a screen size, both read off
// the user agent. Deliberately nothing more identifying than that.
function coarsePlatform(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

export function deviceLabel(): string {
  const w = window.screen?.width ?? window.innerWidth;
  const h = window.screen?.height ?? window.innerHeight;
  return `${coarsePlatform()} · ${w}×${h}`;
}

export function openFeedbackSheet(): void {
  // ── Shell ──
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet feedback-sheet';

  // Lift the sheet above the on-screen keyboard while a field is focused, so the
  // Send button stays reachable (mirrors the import sheet).
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
  title.textContent = 'Send feedback';
  sheet.appendChild(title);

  // ── Category chips: Bug / Idea / Other ──
  let category: Category = 'Bug';
  const chipLabel = document.createElement('label');
  chipLabel.className = 'edit-label';
  chipLabel.textContent = 'What kind?';
  sheet.appendChild(chipLabel);

  const chips = document.createElement('div');
  chips.className = 'seg-control feedback-chips';
  chips.setAttribute('role', 'group');
  const chipButtons: HTMLButtonElement[] = [];
  const reflectChips = () => {
    for (const b of chipButtons) {
      const on = b.dataset.value === category;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  for (const c of ['Bug', 'Idea', 'Other'] as Category[]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.value = c;
    b.textContent = c;
    b.addEventListener('click', () => { category = c; reflectChips(); });
    chipButtons.push(b);
    chips.appendChild(b);
  }
  reflectChips();
  sheet.appendChild(chips);

  // ── Message ──
  const msgLabel = document.createElement('label');
  msgLabel.className = 'edit-label';
  msgLabel.textContent = 'Message';
  sheet.appendChild(msgLabel);

  const message = document.createElement('textarea');
  message.className = 'edit-input feedback-message';
  message.rows = 4;
  message.placeholder = 'What happened, or what would make Bito Chess better?';
  sheet.appendChild(message);

  // ── Optional reply email ──
  const emailLabel = document.createElement('label');
  emailLabel.className = 'edit-label';
  emailLabel.textContent = 'Your email (optional)';
  sheet.appendChild(emailLabel);

  const email = document.createElement('input');
  email.type = 'email';
  email.className = 'edit-input';
  email.placeholder = 'So I can reply';
  email.autocomplete = 'email';
  sheet.appendChild(email);

  // ── Honeypot — hidden from people, tempting to bots. Web3Forms rejects the
  // submission if its `botcheck` field comes back filled. Kept off-screen rather
  // than display:none so naive scrapers still see it. ──
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'botcheck';
  honeypot.className = 'feedback-honeypot';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');
  sheet.appendChild(honeypot);

  // ── Preview of exactly what gets auto-attached ──
  const preview = document.createElement('p');
  preview.className = 'feedback-preview';
  preview.textContent = `Attached automatically: v${__APP_VERSION__} · ${deviceLabel()}`;
  sheet.appendChild(preview);

  // ── Status line — success and failure both land here, clearly. ──
  const status = document.createElement('p');
  status.className = 'settings-note';
  status.setAttribute('aria-live', 'polite');

  // ── Actions ──
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'btn-primary feedback-send-btn';
  sendBtn.textContent = 'Send';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Close';
  cancelBtn.addEventListener('click', close);

  sendBtn.addEventListener('click', async () => {
    const text = message.value.trim();
    if (!text) {
      status.textContent = 'Add a message first.';
      message.focus();
      return;
    }

    sendBtn.disabled = true;
    cancelBtn.disabled = true;
    status.textContent = 'Sending…';

    const replyEmail = email.value.trim();
    const payload: Record<string, unknown> = {
      access_key: ACCESS_KEY,
      subject: `Bito Chess feedback — ${category}`,
      from_name: 'Bito Chess feedback',
      category,
      message: text,
      app_version: __APP_VERSION__,
      device: deviceLabel(),
      botcheck: honeypot.value, // honeypot — must stay empty for a real person
    };
    if (replyEmail) {
      payload.email = replyEmail;   // Web3Forms uses this as the reply-to
      payload.replyto = replyEmail;
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Collapse to a clean confirmation and leave only a Done button.
        sheet.innerHTML = '';
        const ok = document.createElement('h3');
        ok.className = 'edit-sheet-title';
        ok.textContent = 'Thanks ✓';
        const body = document.createElement('p');
        body.className = 'section-desc';
        body.textContent = replyEmail
          ? 'Your feedback is on its way. I’ll reply to the email you gave.'
          : 'Your feedback is on its way.';
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'btn-primary feedback-send-btn';
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
  message.focus();
}
