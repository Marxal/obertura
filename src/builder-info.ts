// One sentence-and-a-bit per builder tab, behind the small (i) at the bottom
// right of the sheet.
//
// WHY IT EXISTS. The builder is five panels deep and every one of them answers a
// different question from the same board position. Which panel answers which was
// only ever discoverable by opening them all — the first-run walkthrough says it
// once, and then it is gone for good. This is the same explanation, permanently
// one tap away, in the corner rather than in the way.
//
// KEEP THESE SHORT. Two short paragraphs at the very most: what this tab shows,
// and what you can do on it. Anything longer is a manual, and nobody reads a
// manual from a phone in the middle of building a line.
//
// The Library tab is the exception and isn't here: its (i) is builder-panels.ts's
// showDbInfo, which has to carry the Lichess connect/disconnect buttons as well
// as the explanation.

import { showDialog } from './dialog';
import { t } from './i18n';

export type BuilderInfoId = 'grow' | 'explore' | 'mylines' | 'line' | 'game' | 'engine';

const COPY: Record<BuilderInfoId, { title: string; body: string }> = {
  grow: {
    title: t('builder.growLine'),
    body:
      t('builder.todaySLineTo'),
  },
  explore: {
    title: t('tour.explore.title'),
    body:
      t('builder.threeMovesWorthHaving'),
  },
  mylines: {
    title: t('tour.lines.title'),
    body:
      t('builder.whatHappensFromThe'),
  },
  line: {
    title: t('builder.lineInfo'),
    body:
      t('builder.everythingAboutTheLine'),
  },
  game: {
    title: t('builder.game'),
    body:
      t('builder.theGameYouRe'),
  },
  engine: {
    title: t('story.engine'),
    body:
      t('builder.stockfishOnThePosition'),
  },
};

export function showBuilderInfo(id: BuilderInfoId): void {
  const copy = COPY[id];
  showDialog({
    title: copy.title,
    body: copy.body,
    buttons: [{ label: t('tour.gotIt'), variant: 'primary' }],
  });
}

/** The button's accessible name for a tab, so it never just says "info". */
export function builderInfoLabel(id: BuilderInfoId | 'library'): string {
  return id === 'library' ? t('builder.aboutTheOpeningDatabase') : t('builder.about', { title: COPY[id].title });
}
