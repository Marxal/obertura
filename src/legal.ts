// Where the public documents live, resolved for whichever host this bundle was
// built for. Used by Settings → Feedback & about, and by anything else that
// needs to point a user at the policy rather than paraphrase it.
//
// The documents are hand-written static files in docs/ (privacy.html,
// terms.html, licences.html). They are NOT part of the app bundle, and the two
// deploy targets put them in different places relative to the app:
//
//   cloudflare  app at /app/,      docs copied to the site ROOT  → /privacy.html
//   github      app at /obertura/, docs copied to dist/docs/     → /obertura/docs/privacy.html
//
// So the app's own BASE_URL is exactly the wrong prefix on one target and
// exactly the right one on the other — hence the split. Deriving both from
// BASE_URL rather than hard-coding a domain keeps a local `vite dev` and a
// preview build working too.

import { activeLanguage } from './language';
import { RELEASED_LANGUAGES } from './language-choice';

const DOC_BASE =
  __DEPLOY_TARGET__ === 'cloudflare'
    // BASE_URL is '/app/'; the documents sit one level up, at the site root.
    ? new URL('../', new URL(import.meta.env.BASE_URL, location.origin)).pathname
    // BASE_URL is '/obertura/'; the whole docs/ folder is copied inside it.
    : `${import.meta.env.BASE_URL}docs/`;

// The documents exist in each released language (scripts/landing-pages.mjs), and are in
// English before a language is released.
const LANGUAGE = activeLanguage();
const TRANSLATED_BASE = __DEPLOY_TARGET__ === 'cloudflare' && LANGUAGE !== 'en' && RELEASED_LANGUAGES.includes(LANGUAGE)
  ? `${DOC_BASE}${LANGUAGE}/`
  : DOC_BASE;

export const PRIVACY_URL = `${TRANSLATED_BASE}privacy.html`;
export const TERMS_URL = `${TRANSLATED_BASE}terms.html`;
export const LICENCES_URL = `${TRANSLATED_BASE}licences.html`;

// The marketing landing page — index.html of that same folder, which is the
// site root on Cloudflare and the docs folder on the GitHub Pages mirror. This
// is what the Settings "About" row opens.
export const LANDING_URL = DOC_BASE;

// Open one of the above in a new tab. Always noopener/noreferrer: the app is a
// PWA and a document tab must never get scripting access back to it.
export function openDoc(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
