// The app's entry point. It sets up the language first and only then loads the
// rest, because screens are built as soon as their modules load, and many modules
// keep sentences in constants: every t() in them needs the dictionary ready.
//
// With an ES import, there is no way to wait for something before a sibling import
// runs, so main.ts has to be a dynamic import. The icon splash in index.html stays
// up meanwhile, so waiting never shows a blank page.

// `beforeinstallprompt` fires once and early, so its listener can't wait.
import './gate';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import './desktop.css';
import { loadLanguage } from './language';

void loadLanguage().then(() => import('./main'));
