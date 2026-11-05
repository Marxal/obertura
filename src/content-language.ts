// The chess writing that isn't part of the app's sentences: starter pack notes and
// traps. It lives in its own file per language (src/locales/content/), so it only
// loads when someone opens those lists instead of with every start of the app.
//
// The English in starter-packs.json and traps.json stays the source, and the moves
// never leave it: a translation only ever replaces words. A line or trap that has
// no translation stays in English, one piece at a time.
//
// Lines and traps are matched by their English name, so reordering the source can't
// put a note on the wrong line. Filters and matching keep reading the English values
// (`level`, `style`, `family`), which is why those are shown through labels instead.

import { activeLanguage } from './language';
import { t, type MessageKey } from './i18n';
import type { Pack } from './onboarding-starter';
import type { Trap, TrapPack } from './traps';

export interface LineWords { name?: string; plan?: string; notes?: Record<string, string> }
export interface PackWords { title?: string; blurb?: string; lines?: Record<string, LineWords> }
export interface TrapWords { name?: string; bait?: string; idea?: string }
export interface TrapGroupWords { title?: string; blurb?: string; traps?: Record<string, TrapWords> }
export interface ContentWords {
  packs?: Record<string, PackWords>;
  traps?: Record<string, TrapGroupWords>;
}

const CONTENT: Partial<Record<string, () => Promise<ContentWords>>> = {
  ca: () => import('./locales/content/ca.json').then((m) => m.default as ContentWords),
  es: () => import('./locales/content/es.json').then((m) => m.default as ContentWords),
  sv: () => import('./locales/content/sv.json').then((m) => m.default as ContentWords),
};

// English needs nothing, and a failed load only means English text.
let wordsPromise: Promise<ContentWords | null> | null = null;
export function loadContentWords(): Promise<ContentWords | null> {
  if (!wordsPromise) {
    const load = CONTENT[activeLanguage()];
    wordsPromise = load ? load().catch(() => null) : Promise.resolve(null);
  }
  return wordsPromise;
}

export function translatePacks(packs: Pack[], words?: Record<string, PackWords>): Pack[] {
  if (!words) return packs;
  return packs.map((pack) => {
    const w = words[pack.id];
    if (!w) return pack;
    return {
      ...pack,
      title: w.title ?? pack.title,
      blurb: w.blurb ?? pack.blurb,
      lines: pack.lines.map((line) => {
        const l = w.lines?.[line.name];
        if (!l) return line;
        return {
          ...line,
          name: l.name ?? line.name,
          plan: l.plan ?? line.plan,
          // Note by note, so one missing translation can't lose the others.
          notes: line.notes && { ...line.notes, ...l.notes },
        };
      }),
    };
  });
}

export function translateTraps(groups: TrapPack[], words?: Record<string, TrapGroupWords>): TrapPack[] {
  if (!words) return groups;
  return groups.map((group) => {
    const w = words[group.id];
    if (!w) return group;
    return {
      ...group,
      title: w.title ?? group.title,
      blurb: w.blurb ?? group.blurb,
      traps: group.traps.map((trap): Trap => {
        const x = w.traps?.[trap.name];
        return x ? { ...trap, name: x.name ?? trap.name, bait: x.bait ?? trap.bait, idea: x.idea ?? trap.idea } : trap;
      }),
    };
  });
}

const LEVEL_LABELS: Record<string, MessageKey> = {
  Beginner: 'open.tag.beginner',
  'Easy to learn': 'pack.level.easy',
  Intermediate: 'open.tag.intermediate',
  Advanced: 'open.tag.advanced',
};
const STYLE_LABELS: Record<string, MessageKey> = {
  Universal: 'pack.style.universal',
  Solid: 'pack.style.solid',
  Aggressive: 'pack.style.aggressive',
  Classical: 'pack.style.classical',
};

export function levelLabel(level: string): string {
  const key = LEVEL_LABELS[level];
  return key ? t(key) : level;
}

export function styleLabel(style: string): string {
  const key = STYLE_LABELS[style];
  return key ? t(key) : style;
}
