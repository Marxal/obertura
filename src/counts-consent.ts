// The one question about counting, asked once on each device.
//
// EU rules treat the small notes metrics.ts keeps on the device like cookies:
// they're for statistics, so they need a yes first, and a switch in Settings
// isn't enough. Until there's an answer the app stores nothing for counting and
// sends nothing except the single word `counts_asked`, which needs no storage.
//
// Both answers get the same button and the same effort, and the app works the
// same either way. Settings → "Leave me out of the counts" changes the answer.

import { countChoice, metricsActive, sendStateless, setCountChoice } from './metrics';
import { PRIVACY_URL, openDoc } from './legal';

export function maybeAskAboutCounts(): void {
  if (!metricsActive() || countChoice() !== null) return;
  sendStateless('counts_asked');

  const overlay = document.createElement('div');
  overlay.className = 'counts-consent';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'counts-consent-title');

  const card = document.createElement('div');
  card.className = 'counts-consent-card';

  const title = document.createElement('h2');
  title.id = 'counts-consent-title';
  title.textContent = 'Can Bito count how the app is used?';

  const body = document.createElement('p');
  body.textContent = 'Anonymous counts like “a line was saved”, with no cookies and nothing '
    + 'that identifies you. This device keeps a small note of what it has counted.';

  const privacy = document.createElement('button');
  privacy.type = 'button';
  privacy.className = 'counts-consent-link';
  privacy.textContent = 'Privacy policy';
  privacy.addEventListener('click', () => openDoc(PRIVACY_URL));

  const answers = document.createElement('div');
  answers.className = 'counts-consent-answers';
  const answer = (label: string, allow: boolean): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.textContent = label;
    button.addEventListener('click', () => {
      setCountChoice(allow);
      overlay.remove();
    });
    return button;
  };
  answers.append(answer('No thanks', false), answer('Allow', true));

  card.append(title, body, privacy, answers);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
