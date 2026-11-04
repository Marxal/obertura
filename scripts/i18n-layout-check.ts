// Does the app's layout survive a language? Run with: npm run i18n:layout
//
// Opens each screen in a headless browser at 360 and 412 px, in English and in each
// language asked for, and reports text that gets cut off, sideways scrolling, and
// buttons that overflow their container. English is the baseline: only what's NEW
// in another language counts as a failure, so old quirks don't hide new ones. It
// also counts visible text with no translation, which only the fake language shows.
//
//   npm run i18n:layout                  checks the fake language, xx
//   npm run i18n:layout -- ca es         checks those languages
//   npm run i18n:layout -- xx --shots=DIR   also saves a screenshot of each screen
//   npm run i18n:layout -- xx --baseline    also lists the problems English already has
//   npm run i18n:layout -- xx --untranslated   also lists the text still in English, per screen
//
// It tests what `npm run build` last produced, so build first. Playwright isn't a
// repo dependency (the deploy has no use for it): `npm i --no-save playwright`.
//
// The rule from TRANSLATION-PLAN.md: a language doesn't ship while this fails.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { Chess } from 'chess.js';
import { makeIdFactory, mergePath, newRepertoire, type MergeStep } from '../src/repertoire';

const PORT = 4179;
const BASE = `http://localhost:${PORT}/obertura/`;
const WIDTHS = [360, 412];

const args = process.argv.slice(2);
const shotsDir = args.find((a) => a.startsWith('--shots='))?.slice('--shots='.length);
const languages = args.filter((a) => !a.startsWith('--'));
if (!languages.length) languages.push('xx');

// ── A believable profile, so screens show their real content ─────────────────
const LINES: Record<'white' | 'black', string[]> = {
  white: [
    'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7',
    'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6',
    'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6',
  ],
  black: [
    'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5',
    'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6',
    'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5',
  ],
};

function seedRepertoires() {
  return (['white', 'black'] as const).map((colour) => {
    const book = newRepertoire(colour);
    const ids = makeIdFactory(book.tree);
    for (const line of LINES[colour]) {
      const chess = new Chess();
      const steps: MergeStep[] = line.split(' ').map((san) => {
        const move = chess.move(san);
        return { san: move.san, uci: move.from + move.to + (move.promotion ?? ''), fen: chess.fen() };
      });
      mergePath(book.tree, steps, ids);
    }
    return book;
  });
}

// What Chess.com's public API answers, so first run reaches its recap with no network.
function seedChessComGames(): object[] {
  const games: object[] = [];
  (['white', 'black'] as const).forEach((colour) => {
    LINES[colour].forEach((line, l) => {
      const chess = new Chess();
      for (const san of line.split(' ')) chess.move(san);
      for (let i = 0; i < 5; i++) {
        const won = i % 3 !== 2;
        const me = { username: 'tester', rating: 1850, result: won ? 'win' : 'resigned' };
        const them = { username: `rival${i}`, rating: 1840, result: won ? 'resigned' : 'win' };
        const result = won === (colour === 'white') ? '1-0' : '0-1';
        games.push({
          url: `https://www.chess.com/game/live/${colour}${l}${i}`,
          pgn: chess.pgn().replace('[Result "*"]', `[Result "${result}"]`).replace(/\*$/, result),
          time_control: i % 2 ? '600' : '180',
          time_class: i % 2 ? 'rapid' : 'blitz',
          rules: 'chess',
          end_time: 1790000000 + games.length * 3600,
          white: colour === 'white' ? me : them,
          black: colour === 'white' ? them : me,
        });
      }
    });
  });
  return games;
}

// ── What runs inside the page ────────────────────────────────────────────────
interface Problem { kind: string; where: string; text: string }

function inspectPage(): { problems: Problem[]; untranslated: string[] } {
  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 5; e = e.parentElement) {
      const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : '';
      parts.unshift(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : cls ? `.${cls}` : ''));
    }
    return parts.join(' > ');
  };
  const shown = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.width > 0 && r.height > 0;
  };
  // In the slide or tab that's on screen, not one parked off to the side.
  const onScreen = (r: DOMRect): boolean => r.bottom > 0 && r.left < innerWidth * 1.5 && r.right > -innerWidth * 0.5;
  // Places where running past the edge is the design: a strip that scrolls sideways.
  const insideScroller = (el: Element): boolean => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };

  const problems: Problem[] = [];
  const untranslated: string[] = [];
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth + 1) {
    problems.push({ kind: 'page scrolls sideways', where: 'html', text: `${root.scrollWidth - root.clientWidth}px too wide` });
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').trim();
    const el = node.parentElement;
    if (!el || !/[\p{L}]{2}/u.test(text)) continue;
    if (['SCRIPT', 'STYLE', 'OPTION', 'TEXTAREA'].includes(el.tagName) || el.closest('svg, cg-board, coords')) continue;
    if (!shown(el)) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !onScreen(rect)) continue;
    if (!text.includes('[') && !text.includes(']')) untranslated.push(text.slice(0, 70));
    if (seen.has(el)) continue;
    seen.add(el);
    const where = pathOf(el);
    const short = text.slice(0, 70);
    const cs = getComputedStyle(el);

    if (cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll'
      && el.scrollWidth > el.clientWidth + 1) {
      problems.push({ kind: cs.textOverflow === 'ellipsis' ? 'cut off with …' : 'cut off', where, text: short });
      continue;
    }
    if (insideScroller(el)) continue;
    if (rect.right > innerWidth + 1) {
      problems.push({ kind: 'runs off the screen', where, text: short });
      continue;
    }
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const overflow = getComputedStyle(a).overflowX;
      if (overflow !== 'hidden' && overflow !== 'clip') continue;
      if (rect.right > a.getBoundingClientRect().right + 1) {
        problems.push({ kind: 'cut off by its box', where, text: short });
      }
      break;
    }
    const button = el.closest('button, [role="button"], .btn');
    if (button?.parentElement && !insideScroller(button)
      && button.getBoundingClientRect().right > button.parentElement.getBoundingClientRect().right + 1) {
      problems.push({ kind: 'button overflows', where: pathOf(button), text: short });
    }
  }
  return { problems, untranslated };
}

// ── Walking the screens ──────────────────────────────────────────────────────
type Page = import('playwright').Page;
type Browser = import('playwright').Browser;
interface Result { screen: string; width: number; problems: Problem[]; untranslated: string[] }

async function newContext(browser: Browser, width: number, seeded: boolean, lang: string) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  // Nothing here should touch the network, least of all the live site.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`http://localhost:${PORT}/`)) return route.continue();
    const answer = (body: object) => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    if (url.endsWith('/games/archives')) return answer({ archives: ['https://api.chess.com/pub/player/tester/games/2026/10'] });
    if (url.endsWith('/games/2026/10')) return answer({ games: seedChessComGames() });
    if (url.endsWith('/player/tester')) return answer({ username: 'tester', player_id: 1 });
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?lang=${lang}`, { waitUntil: 'load' });
  if (seeded) {
    await page.waitForTimeout(600);
    await page.evaluate(async (books) => {
      localStorage.setItem('obertura.onboardingComplete', '1');
      localStorage.setItem('obertura.builderTourDone', '1');
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('obertura');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('repertoires', 'readwrite');
          for (const book of books) tx.objectStore('repertoires').put(book);
          tx.oncomplete = () => { open.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, JSON.parse(JSON.stringify(seedRepertoires())));
    await page.reload({ waitUntil: 'load' });
  }
  await page.waitForTimeout(900);
  return { context, page };
}

async function record(page: Page, screen: string, width: number, lang: string, out: Result[]): Promise<void> {
  await page.waitForTimeout(500);
  const { problems, untranslated } = await page.evaluate(inspectPage);
  out.push({ screen, width, problems, untranslated });
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${lang}-${width}-${screen}.png` });
}

async function walk(browser: Browser, lang: string, width: number): Promise<Result[]> {
  const out: Result[] = [];

  const fresh = await newContext(browser, width, false, lang);
  await record(fresh.page, 'first-run', width, lang, out);
  await fresh.page.click('.where-tab:nth-child(3)');
  await record(fresh.page, 'first-run-elsewhere', width, lang, out);
  await fresh.page.click('.where-tab:nth-child(1)');
  await fresh.page.fill('.where-input', 'tester');
  await fresh.page.click('.where-go');
  await fresh.page.waitForSelector('.recap-stage', { timeout: 30000 });
  await record(fresh.page, 'recap', width, lang, out);
  await fresh.page.click('.recap-skip');
  await record(fresh.page, 'recap-skip', width, lang, out);
  await fresh.page.click('.recap-foot .btn-primary');
  await fresh.page.click('.recap-save');
  await fresh.page.waitForFunction(() => !document.querySelector('.recap-stage'));
  await record(fresh.page, 'first-run-done', width, lang, out);
  await fresh.context.close();

  // The two ways in with no games: starter packs, and building a line by hand.
  const packs = await newContext(browser, width, false, lang);
  await packs.page.click('.where-tab:nth-child(3)');
  await packs.page.click('.where-go.btn-primary');
  await packs.page.waitForSelector('.onb-pack-head');
  await record(packs.page, 'starter-packs', width, lang, out);
  await packs.page.click('.onb-pack-head');
  await record(packs.page, 'starter-pack-open', width, lang, out);
  await packs.context.close();

  const own = await newContext(browser, width, false, lang);
  await own.page.click('.where-tab:nth-child(3)');
  await own.page.click('.where-go--second');
  await own.page.waitForSelector('.picker-colour');
  await record(own.page, 'colour-picker', width, lang, out);
  await own.page.click('.picker-colour');
  await own.page.click('.picker-start');
  await own.page.waitForSelector('.tour-bubble');
  await record(own.page, 'builder-tour', width, lang, out);
  await own.context.close();

  const { context, page } = await newContext(browser, width, true, lang);
  for (const view of ['home', 'train', 'explore', 'games', 'progress']) {
    await page.click(`#bottom-nav [data-view="${view}"]`);
    await record(page, view, width, lang, out);
  }
  await page.click('#nav-settings');
  await record(page, 'settings', width, lang, out);
  const groups = await page.$$('details > summary');
  for (let i = 0; i < groups.length; i++) {
    await groups[i].click();
    await record(page, `settings-${i + 1}`, width, lang, out);
  }
  await context.close();

  // The Pro popup, and what declining it says to a guest.
  const offer = await newContext(browser, width, true, lang);
  await offer.page.click('#nav-settings');
  await offer.page.click('.settings-gopro-btn');
  await offer.page.waitForSelector('.pro-sheet');
  await record(offer.page, 'pro-popup', width, lang, out);
  await offer.page.click('.pro-later');
  await record(offer.page, 'pro-declined', width, lang, out);
  await offer.context.close();

  // Training: the modes explained, a drill, and leaving one.
  const drill = await newContext(browser, width, true, lang);
  await drill.page.click('#bottom-nav [data-view="train"]');
  await drill.page.click('.info-btn:visible');
  await record(drill.page, 'train-info', width, lang, out);
  await drill.page.click('.dialog-btn-row .btn-primary');
  await drill.page.click('.train-door:visible');
  await drill.page.waitForSelector('.pt-overlay');
  await drill.page.waitForTimeout(1200);
  await record(drill.page, 'drill', width, lang, out);
  await drill.page.click('.pt-header-end');
  await record(drill.page, 'drill-leave', width, lang, out);
  await drill.context.close();

  // The import sheet, from a profile that already has lines but no games.
  const later = await newContext(browser, width, true, lang);
  await later.page.click('#bottom-nav [data-view="games"]');
  await later.page.fill('.inline-import input', 'tester');
  await later.page.press('.inline-import input', 'Enter');
  await later.page.waitForSelector('.import-found', { timeout: 30000 });
  await record(later.page, 'import-choose', width, lang, out);
  await later.context.close();
  return out;
}

// ── Running it ───────────────────────────────────────────────────────────────
const { chromium } = await import('playwright').catch(() => {
  console.error('Playwright is missing. Install it for this checkout with: npm i --no-save playwright');
  process.exit(2);
});
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stopServer = (): void => { try { process.kill(-server.pid!); } catch { /* already gone */ } };
for (let i = 0; ; i++) {
  const up = await fetch(BASE).then((r) => r.ok, () => false);
  if (up) break;
  if (i > 50) { stopServer(); throw new Error('The preview server did not start. Has `npm run build` been run?'); }
  await new Promise((r) => setTimeout(r, 200));
}

let failed = false;
const browser = await chromium.launch();
try {
  const signature = (r: { screen: string; width: number }, p: Problem): string => `${r.screen}|${r.width}|${p.kind}|${p.where}`;
  const baseline = new Set<string>();
  const inEnglish: string[] = [];
  for (const width of WIDTHS) {
    for (const r of await walk(browser, 'en', width)) {
      r.problems.forEach((p) => {
        baseline.add(signature(r, p));
        inEnglish.push(`  ${r.screen} @${width}  ${p.kind}: "${p.text}"\n      ${p.where}`);
      });
    }
  }
  console.log(`English baseline: ${baseline.size} existing problems, ignored below.`);
  if (args.includes('--baseline')) console.log(inEnglish.join('\n'));
  console.log('');

  for (const lang of languages) {
    const results: Result[] = [];
    for (const width of WIDTHS) results.push(...await walk(browser, lang, width));
    const fresh = results.flatMap((r) => r.problems.filter((p) => !baseline.has(signature(r, p))).map((p) => ({ ...p, screen: r.screen, width: r.width })));
    const untranslated = new Set(results.flatMap((r) => r.untranslated));

    console.log(`── ${lang} ──`);
    console.log(`Screens checked: ${results.length} (${results.length / WIDTHS.length} at each of ${WIDTHS.join(' and ')} px)`);
    if (lang === 'xx') console.log(`Visible text not going through t(): ${untranslated.size} different strings`);
    if (lang === 'xx' && args.includes('--untranslated')) {
      for (const r of results) {
        const here = [...new Set(r.untranslated)];
        if (r.width === WIDTHS[0] && here.length) console.log(`  ${r.screen}: ${here.join(' | ')}`);
      }
    }
    if (fresh.length) {
      failed = true;
      console.log(`NEW problems: ${fresh.length}`);
      for (const p of fresh) console.log(`  ${p.screen} @${p.width}  ${p.kind}: "${p.text}"\n      ${p.where}`);
    } else {
      console.log('NEW problems: none');
    }
    console.log('');
  }
} finally {
  await browser.close();
  stopServer();
}
process.exit(failed ? 1 : 0);
