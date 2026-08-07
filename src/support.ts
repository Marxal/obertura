// "Buy me a coffee" — two ways to chip in, shown as a section in Settings.
//   • Swish — opens the Swish app pre-filled with 50 kr on a Swedish phone (and
//     does nothing elsewhere). Text only, no logo.
//   • Card  — opens my Ko-fi page in the browser, where you can pay by card.

const KOFI_URL = 'https://ko-fi.com/marxal';

// Deep link that opens Swish pre-filled. Amount defaults to 50 kr but stays
// editable; the payment data is URL-encoded onto the swish:// scheme.
const SWISH_DEEPLINK = (() => {
  const data = {
    version: 1,
    payee: { value: '+46761899199', editable: false },
    amount: { value: 50, editable: true },
    message: { value: 'Bito Chess', editable: true },
  };
  return `swish://payment?data=${encodeURIComponent(JSON.stringify(data))}`;
})();

export function buildSupportSection(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'support-section';

  const heading = document.createElement('h3');
  heading.className = 'settings-subheading';
  heading.textContent = 'Buy me a coffee ☕';
  wrap.appendChild(heading);

  // Swish — text only, 50 kr.
  const swish = document.createElement('a');
  swish.href = SWISH_DEEPLINK;
  swish.className = 'btn-primary support-btn';
  swish.textContent = 'Swish · 50 kr';
  wrap.appendChild(swish);

  // Card — opens Ko-fi in a new tab.
  const card = document.createElement('a');
  card.href = KOFI_URL;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.className = 'btn-secondary support-btn';
  card.textContent = 'Card';
  wrap.appendChild(card);

  return wrap;
}
