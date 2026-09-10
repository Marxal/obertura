// The Middlegame box on the Train screen — drills the exact positions from your
// own imported games where you went wrong. This file renders the box: its door
// (the mix), the "Analyse my games" scan with its progress overlay, and the
// seven exercise cards. The scan itself lives in mistake-scan.ts and the solving
// overlay in mistake-run.ts.
//
// GONE FROM HERE, AND WHERE IT WENT. The stats hero ("318 games read · 41 spots
// · 12 fixed") and the latest-mistakes carousel of board miniatures used to head
// this pane. Both are things you read rather than start, they were the two
// tallest blocks on it, and both are Home's job — see the ROADMAP round "Train
// becomes four boxes". Their code is in git at eecb0d7 if Home wants it back
// rather than rebuilt. The autoscan's live status went with the hero; the
// background pass is still kicked off at boot by main.ts, and the "Analyse new
// games" card reports what is left to read.

import type { ImportedGame } from './import-core';
import { getAllGames } from './storage';
import { buildInlineImport } from './import-inline';
import { renderLoadError } from './load-error';
import { Icons, classIcon, CLASS_COLOR } from './icons';
import { buildModeCard } from './train-screen';
import { buildDoor, buildBox, boxBody, DOMAIN_ACCENT } from './train-doors';
import { openInfoSheet, buildInfoButton } from './info-sheet';
import {
  isEntitled, FREE_MISTAKE_GAME_WINDOW, FREE_MISTAKE_SPOTS,
} from './entitlement';
import {
  startMistakeSession,
  CATEGORY_LABEL,
  CATEGORY_PHRASE,
  CATEGORY_BADGE,
  type OpenGameCtx,
} from './mistake-run';
import {
  collectSpots,
  pickSpots,
  countRetry,
  capMistakeGamesForTier,
} from './mistake-scan';
import type { MistakeCategory, RetryCounts, SpotRef } from './mistake-scan';
import { startBrilliantSession } from './brilliant-run';
import {
  collectBrilliantSpots,
  orderBrilliant,
  type BrilliantRef,
} from './brilliant';
import { brilliantDueMap } from './brilliant-log';
import {
  collectDetectiveSpots,
  pickDetective,
  readyDetectiveCount,
  type DetectiveRef,
} from './detective';
import { startDetectiveSession, openDetectiveInfo } from './detective-run';
import { fairPairs, pickWhichMove, readyWhichMoveCount } from './which-move';
import { startWhichMoveSession, openWhichMoveInfo } from './which-move-run';
import { detectiveLog, whichMoveLog } from './middle-log';
import { startTimePressureSession } from './time-pressure-run';
import { dealRound, getTimePressureBest } from './time-pressure';
import { combinedDueAt, restKey } from './spot-rest';
import { openFixedSheet } from './fixed-sheet';
import {
  DETECTIVE_ACCENT, WHICH_MOVE_ACCENT, CATEGORY_ACCENT, TIME_PRESSURE_ACCENT,
} from './exercise-identity';

// Session size for a category card tap — five positions, like a puzzle run.
const SESSION_SIZE = 5;

// The two whole-game exercises run shorter and longer than that respectively: a
// detective case is four to six moves to read plus an answer, so three of them
// is already a sitting; a two-move question is ten seconds, so six of them is
// the same amount of time.
const DETECTIVE_SESSION = 3;
const WHICH_MOVE_SESSION = 6;

// The mixed run at the top of the pane. It deals from EVERY exercise in this
// section, not just two of them: the quick two-move questions to warm up, then
// mistake positions round-robin across the four categories, then a detective
// case or two, and it closes on your own best moves.
//
// They run back to back as legs of one chain rather than shuffled into one
// another, because they are four genuinely different exercises — the same shape
// the daily challenge uses to pass from one of its parts to the next. Each leg
// is short; the point of the mix is the spread, not the volume.
const MIX_WHICH_MOVE = 3;
const MIX_MISTAKES = 6;
const MIX_DETECTIVE = 2;
const MIX_BRILLIANT = 3;

// Brilliancies are scarce. Below this many of your own, the card pools the
// engine's "great" grade in with them so the exercise has something to deal;
// once you have a proper collection it narrows to the real thing.
const BRILLIANT_ONLY_FROM = 10;

// The palette for all of this now lives in exercise-identity.ts — the exercise
// OVERLAYS wear it too (their header carries the icon and colour of the card
// that launched them), and a leaf module is the only place both can reach.

const CATEGORY_SUB: Record<MistakeCategory, string> = {
  'opening-blunder': 'openings that lost you the game',
  'punish-opening': 'chances your opponent handed you',
  'missed-win': 'winning positions you let slip',
  'blunder': 'game-losing moves from level play',
};

// Sized by the caller: 20 on the cards, 18 in an exercise's run header.
const CATEGORY_ICON: Record<MistakeCategory, (size?: number) => SVGElement> = {
  'opening-blunder': (s = 20) => Icons.zap(s),
  'punish-opening': (s = 20) => Icons.target(s),
  'missed-win': (s = 20) => Icons.star(s),
  'blunder': (s = 20) => Icons.alert(s),
};

const CATEGORIES: MistakeCategory[] = ['opening-blunder', 'punish-opening', 'missed-win', 'blunder'];

// This domain's own colour — the door, the readouts, every tile's top edge, and
// the few tiles that have no exercise accent of their own.
const MIDDLEGAME_ACCENT = DOMAIN_ACCENT.middlegame;

// What the five exercises here actually are. The card subtitles are one short
// line each — enough to tell them apart in a menu, not enough to say where the
// positions come from or why a "blunder" and an "opening blunder" are two
// different cards. That answer lives one tap away rather than on every card.
function openMistakeInfo(): void {
  openInfoSheet({
    title: 'From your games',
    intro: 'Every position here is one you actually played. The engine reads your imported '
      + 'games, marks the moves where the evaluation swung, and hands the position back to '
      + 'you as it was — before you played the move.',
    entries: [
      {
        icon: Icons.sparkles(18), accent: CATEGORY_ACCENT['punish-opening'],
        label: 'Your games mix',
        detail: 'The button at the top, and the one to press if you do not want to choose. '
          + 'It runs every exercise on this screen back to back — two-move questions, then '
          + 'mistake positions from all four cards in turn, then a detective case or two, '
          + 'and it finishes on your own best moves. Each leg is short; whatever has nothing '
          + 'to deal is simply skipped.',
      },
      {
        icon: Icons.scout(18), accent: DETECTIVE_ACCENT,
        label: 'Blunder detective',
        detail: 'A run of four to six moves from one of your games with exactly one blunder '
          + 'in it — yours or your opponent’s, and nothing says which. Step through, name it, '
          + 'then play what should have been played. One run per game at most.',
      },
      {
        icon: Icons.merge(18), accent: WHICH_MOVE_ACCENT,
        label: 'Which move',
        detail: 'The quick one. Two moves drawn on the board — the one you played and the '
          + 'one the engine wanted — and you pick. Ten seconds each, and it ends by telling '
          + 'you which game it was and what the move cost.',
      },
      {
        icon: Icons.clock(18), accent: TIME_PRESSURE_ACCENT,
        label: 'Time pressure',
        detail: 'The speed round. Two minutes, twenty seconds a position, and any of the '
          + 'engine’s top three counts — under that clock the skill is seeing a move that '
          + 'does not lose, not finding the single best one. Nothing is drawn on the board: '
          + 'you read the position cold, exactly as you had it, and the only answer during '
          + 'the round is a tick or a cross. What was actually there is on the results '
          + 'screen, where there is time to look. It opens on the moves you had least time '
          + 'for and works outwards, so it always has something to deal, and finding one '
          + 'inside three seconds is worth double. It is not part of the mix above: two '
          + 'timed minutes does not belong in the middle of a run of untimed ones.',
      },
      {
        icon: Icons.zap(18), accent: CATEGORY_ACCENT['opening-blunder'],
        label: CATEGORY_LABEL['opening-blunder'],
        detail: 'Mistakes inside the first dozen moves — the ones a line in your repertoire '
          + 'would have prevented. The most useful card here, because these repeat.',
      },
      {
        icon: Icons.target(18), accent: CATEGORY_ACCENT['punish-opening'],
        label: CATEGORY_LABEL['punish-opening'],
        detail: 'Your OPPONENT went wrong in the opening and you let it go. Same positions, '
          + 'other side of the board: find the move that punishes it.',
      },
      {
        icon: Icons.star(18), accent: CATEGORY_ACCENT['missed-win'],
        label: CATEGORY_LABEL['missed-win'],
        detail: 'Positions where you were winning and the win slipped. Anywhere in the game, '
          + 'not just the opening.',
      },
      {
        icon: Icons.alert(18), accent: CATEGORY_ACCENT['blunder'],
        label: CATEGORY_LABEL['blunder'],
        detail: 'Game-losing moves from a level position — the plain ??, wherever it landed.',
      },
      {
        icon: classIcon('brilliant', 18), accent: CLASS_COLOR.brilliant,
        label: 'Your brilliant moves',
        detail: 'The opposite exercise: moves the engine graded brilliant (!!) or great (!) '
          + 'when you played them. Find them again. The scan looks for these too — a real '
          + 'sacrifice that works — so they turn up on their own, and any you have graded by '
          + 'reviewing a game in the analyser are added to them. Once you have ten '
          + 'brilliancies the card narrows to those alone. Solved ones rest, then come back.',
      },
    ],
    footnote: 'Time pressure is the exception to the marking below — it never marks a spot '
      + 'fixed and never rests one, because finding a move in four seconds under a clock is '
      + 'not the same as working it out. Reset, under the mix button, starts all of this again: the spots go, every game '
      + 'is read from scratch, and every brilliant move you have re-found becomes available '
      + 'again. A card stays greyed out until the scan has found something for it. A spot you '
      + 'get right is marked fixed and goes to the back of its queue — it only comes round '
      + 'again once the unfixed ones have run out, and the "to fix" count never counts it. '
      + 'A brilliant move you re-find rests for a few days and then returns, longer each '
      + 'time you find it again.',
  });
}

export interface MistakesScreenDeps {
  // Open a game in the full analyser (builder view) — the session's "Open full
  // analysis" route. The ctx carries the position to open at plus the
  // resume/discard hooks for the suspended session (see main.ts).
  onOpenGame: (game: ImportedGame, ctx?: OpenGameCtx) => void;
}

export async function renderMistakesScreen(host: HTMLElement, deps: MistakesScreenDeps): Promise<void> {
  // `host` is this domain's slice of the Train room and it is `display:
  // contents` (train-doors.ts), so everything appended here becomes an item of
  // the shared grid and sorts into the door / tiles / readouts band by its own
  // class. There is no wrapper element any more — a wrapper would be one grid
  // item holding all three bands, which is exactly what we stopped doing.
  host.innerHTML = '';

  let allGames: ImportedGame[];
  try {
    allGames = await getAllGames();
  } catch (err) {
    renderLoadError(host, err, () => { void renderMistakesScreen(host, deps); });
    return;
  }

  // Everything here trains from your own games, so without an import there is
  // nothing to scan yet — and the import form itself is what the screen shows,
  // rather than a button that opens one.
  if (allGames.length === 0) {
    // The door still shows, greyed, saying what it needs — a domain that simply
    // vanished from the screen would read as a bug, and "import your games" is
    // the one instruction that makes this whole third of the app work.
    host.appendChild(buildDoor({
      domain: 'middlegame',
      icon: Icons.swords(26),
      name: 'Middlegame',
      sub: 'a mixed round from your own games',
      disabled: true,
      disabledReason: 'Import your games and this fills itself',
    }));
    const box = buildBox('middlegame', 'From your games');
    const empty = document.createElement('div');
    empty.className = 'mistakes-empty';
    const line = document.createElement('p');
    line.className = 'empty-state-line';
    line.textContent = 'Train the exact positions where your games went wrong.';
    empty.appendChild(line);
    empty.appendChild(buildInlineImport({
      title: 'Import your games',
      body: 'The scan then finds your blunders, your missed wins and the chances your opponents handed you.',
      onImported: () => { void renderMistakesScreen(host, deps); },
    }));
    boxBody(box).appendChild(empty);
    host.appendChild(box);
    return;
  }

  const entitled = isEntitled();
  // Free tier: a view-only cap (games/spots on disk are never touched) — the
  // 50 most recent games, and a rolling top 10 unfixed spots (fixed spots are
  // never hidden). `games` below drives every stat, card and carousel, so the
  // cap holds everywhere with no further branching.
  const capResult = entitled
    ? { games: allGames, capped: false }
    : capMistakeGamesForTier(allGames, FREE_MISTAKE_GAME_WINDOW, FREE_MISTAKE_SPOTS);
  const games = capResult.games;

  const rerender = (): void => { void renderMistakesScreen(host, deps); };
  // "Games analysed" stays the TRUE lifetime count (never windowed) so an
  // existing tester's history never reads as having vanished; only the spot
  // counts/cards/carousel below are capped.
  const spotCounts = countRetry(games);
  const { scanned, total } = entitled ? spotCounts : countRetry(allGames);
  const counts: RetryCounts = { ...spotCounts, scanned, total };
  const refs = collectSpots(games);
  // The two whole-game exercises, both read off the same scan. The detective
  // runs are stored one per game; the two-move questions are the spots above,
  // filtered down to the ones that make a fair question (which-move.ts).
  const detectiveRefs = collectDetectiveSpots(games);
  const pairRefs = fairPairs(refs);
  // What each exercise may deal, and when. Two things are folded into every
  // one of these: the exercise's OWN rest log, and the shared one under all
  // three (spot-rest.ts) — the same blunder is a detective case, a two-move
  // question and a mistake to fix, and answering it once should quiet all
  // three doors.
  //
  // They are functions, not maps, because they must be read at the moment a
  // session is dealt rather than when the pane was painted: a run started from
  // here files rests as it goes, and "Play again" has to see them or it deals
  // the identical sitting straight back.
  const detectiveDueAt = (): ((id: string) => number) => combinedDueAt(detectiveLog.dueMap());
  const whichMoveDueAt = (): ((id: string) => number) => combinedDueAt(whichMoveLog.dueMap());
  // The mistake drill has no rest log of its own (it orders by the spot's
  // fixed/lastTrained marks); the shared rest is all it consults.
  const spotDueAt = (): ((id: string) => number) => combinedDueAt({});
  const detectiveReady = readyDetectiveCount(detectiveRefs, detectiveDueAt());
  const whichMoveReady = readyWhichMoveCount(refs, whichMoveDueAt());
  // Order the brilliant finds so the carousel + session loop through them:
  // freshly-solved gems rest a while, then resurface (brilliant-log.ts).
  //
  // WHICH FINDS. A brilliant (!!) is rare — plenty of people have two in a
  // hundred games — so a card that only ever offered those would be a card with
  // nothing on it. Below BRILLIANT_ONLY_FROM of them the engine's "great" grade
  // is pooled in to make an exercise; at or above it the card is brilliancies
  // only, because by then there are enough of the real thing to fill a session
  // and mixing greats in would dilute it.
  const allGems = collectBrilliantSpots(games);
  const trueGems = allGems.filter(g => g.spot.cls === 'brilliant');
  const gemsOnly = trueGems.length >= BRILLIANT_ONLY_FROM;
  const dueMap = brilliantDueMap();
  const brilliantRefs = orderBrilliant(gemsOnly ? trueGems : allGems, id => dueMap[id] ?? 0);
  // How many are available RIGHT NOW, as opposed to resting off a recent
  // re-find. This is the figure the card badges, for the same reason the mistake
  // cards badge their unfixed count rather than their total: a number that never
  // moves however much you do is not a number worth printing. It is also what
  // makes Reset visible on this half of the pane — clearing the rest log puts
  // every gem back, and the badge says so.
  const gemsReady = brilliantRefs.filter(
    r => (dueMap[r.spot.id] ?? 0) <= Date.now()).length;

  // The door goes to the top band, the box to the one below — see .train-room.
  //
  // WHAT LEFT THIS SCREEN. The stats hero ("318 games read · 41 spots"), the
  // latest-mistakes carousel, the "Analyse my games" card and the reset link.
  // The first two are readouts rather than things you start; the scan is an
  // action nobody asks for by name (it runs in the background from boot — see
  // main.ts — and Home is where it should say so while it is working); and a
  // reset belongs with the other destructive switches in Settings. What is left
  // in this box is seven exercises and nothing else.
  const mixReady = mixLegs().length > 0;
  const unfixed = counts.spots - counts.fixed;
  host.appendChild(buildDoor({
    domain: 'middlegame',
    icon: Icons.swords(26),
    name: 'Middlegame',
    sub: 'a mixed round from your own games',
    stat: mixReady && unfixed > 0 ? unfixed : undefined,
    statLabel: mixReady && unfixed > 0 ? 'to fix' : undefined,
    disabled: !mixReady,
    disabledReason: counts.scanned === 0
      ? 'Your games are still being read'
      : 'Nothing waiting — they come back over the next few days',
    onClick: () => startMix(),
  }));
  host.appendChild(renderCategoryBox());



  // The wide launch button, or null when the scan has not turned anything up
  // yet — a primary button that can only tell you there is nothing to do is
  // worse than no button.
  // The mistake half of the mix: deal round-robin across the four categories so
  // a library heavy in one of them doesn't fill the whole run with it. Each
  // category's own order is pickSpots's — unfixed and newest first, solved ones
  // behind them — so a spot you have already fixed only turns up once the
  // unfixed ones in its category have run out.
  //
  // `skip` holds the blunders an earlier leg of this same mix has already
  // dealt. The rest logs can't cover that on their own: every leg of a mix is
  // dealt before the first one is answered, so nothing has been filed yet.
  function mixSpots(skip: Set<string>): SpotRef[] {
    const dueAt = spotDueAt();
    const free = refs.filter(r => !skip.has(restKey(r.spot.id)));
    const queues = CATEGORIES.map(cat =>
      pickSpots(free.filter(r => r.spot.category === cat), cat, MIX_MISTAKES, dueAt));
    const out: SpotRef[] = [];
    for (let round = 0; out.length < MIX_MISTAKES; round++) {
      let dealt = false;
      for (const q of queues) {
        if (round >= q.length) continue;
        out.push(q[round]);
        dealt = true;
        if (out.length >= MIX_MISTAKES) break;
      }
      if (!dealt) break;
    }
    return out;
  }

  // ── The mix, as a chain of legs ────────────────────────────────────────────
  //
  // One leg per exercise that has anything to deal, each handing over through
  // its results screen's primary button. The legs are worked out ONCE, when the
  // mix starts, and the index is carried along: a leg's own solves change the
  // rest logs underneath it, so recomputing the list between hops could shuffle
  // what "the next one" means halfway through a run.
  interface MixLeg {
    /** What the previous leg's hand-off button says. */
    label: string;
    start: (next?: { label: string; run: () => void }) => void;
  }

  function mixLegs(): MixLeg[] {
    const legs: MixLeg[] = [];
    const ctx = 'Your games mix';

    // One blunder, one appearance. A mix deals all of its legs up front, so the
    // rest logs are still describing yesterday when the last leg is chosen —
    // this set is the within-the-sitting half of the same rule, and every leg
    // below both reads it and adds to it.
    const claimed = new Set<string>();
    const claim = <T extends { spot: { id: string } }>(dealt: T[]): T[] => {
      for (const r of dealt) claimed.add(restKey(r.spot.id));
      return dealt;
    };

    // Quickest first: ten seconds a question, and it warms up the eye for the
    // blank-board work that follows.
    const pairs = claim(pickWhichMove(pairRefs, MIX_WHICH_MOVE, whichMoveDueAt()));
    if (pairs.length) {
      legs.push({
        label: 'Two moves, one choice',
        start: (next) => startWhichMoveSession({
          refs: pairs,
          contextLabel: ctx,
          onExit: rerender,
          onPlayAgain: () => startMix(),
          onOpenGame: deps.onOpenGame,
          nextAction: next,
        }),
      });
    }

    const spots = claim(mixSpots(claimed));
    if (spots.length) {
      legs.push({
        label: 'Now your mistakes',
        start: (next) => startMistakeSession({
          refs: spots,
          contextLabel: ctx,
          onExit: rerender,
          onPlayAgain: () => startMix(),
          onOpenGame: deps.onOpenGame,
          nextAction: next,
        }),
      });
    }

    const cases = claim(pickDetective(
      detectiveRefs.filter(r => !claimed.has(restKey(r.spot.id))),
      MIX_DETECTIVE, detectiveDueAt()));
    if (cases.length) {
      legs.push({
        label: 'Now find the blunder',
        start: (next) => startDetectiveSession({
          refs: cases,
          contextLabel: ctx,
          onExit: rerender,
          onPlayAgain: () => startMix(),
          onOpenGame: deps.onOpenGame,
          nextAction: next,
        }),
      });
    }

    // The mix closes on the one exercise that is about something you got RIGHT.
    const gems = brilliantRefs.slice(0, MIX_BRILLIANT);
    if (gems.length) {
      legs.push({
        label: 'Now your best moves',
        start: (next) => startBrilliantSession({
          refs: gems,
          contextLabel: ctx,
          onExit: rerender,
          onPlayAgain: () => startMix(),
          onOpenGame: deps.onOpenGame,
          nextAction: next,
        }),
      });
    }

    return legs;
  }

  function startMix(): void {
    runMixLeg(mixLegs(), 0);
  }

  function runMixLeg(legs: MixLeg[], i: number): void {
    const leg = legs[i];
    if (!leg) { rerender(); return; }
    const next = legs[i + 1];
    leg.start(next
      ? { label: `${next.label} →`, run: () => runMixLeg(legs, i + 1) }
      : undefined);
  }
  function renderCategoryBox(): HTMLElement {
    const box = buildBox('middlegame', 'From your games',
      buildInfoButton('About these exercises', openMistakeInfo));
    const section = boxBody(box);

    // Why anything here is dead, said the same way on every card.
    const noneReason = counts.scanned === 0
      ? 'Analyse your games first'
      : 'None found in your analysed games';

    // The two whole-game exercises lead. They ask a smaller question than the
    // category cards ("which of these moves is the blunder", "which of these two
    // moves is better") and they don't need you to choose a category of your own
    // mistakes first, which is a decision a newcomer has no basis for.
    section.appendChild(buildModeCard({
      accent: DETECTIVE_ACCENT,
      icon: Icons.scout(20),
      name: 'Blunder detective',
      sub: detectiveRefs.length > 0 && detectiveReady === 0
        ? 'all cracked — they come back over the next few days'
        : 'find the blunder — yours or theirs',
      stat: detectiveReady > 0 ? detectiveReady : undefined,
      statLabel: detectiveReady > 0 ? 'cases' : undefined,
      disabled: detectiveRefs.length === 0,
      disabledReason: noneReason,
      onClick: () => startDetective(),
    }));
    section.appendChild(buildModeCard({
      accent: WHICH_MOVE_ACCENT,
      icon: Icons.merge(20),
      name: 'Which move',
      sub: pairRefs.length > 0 && whichMoveReady === 0
        ? 'all answered — they come back over the next few days'
        : 'two moves, one of them yours',
      stat: whichMoveReady > 0 ? whichMoveReady : undefined,
      statLabel: whichMoveReady > 0 ? 'to answer' : undefined,
      disabled: pairRefs.length === 0,
      disabledReason: noneReason,
      onClick: () => startWhichMove(),
    }));

    // Time pressure — the speed round. It sits third because it is the one
    // exercise here that is not about working a position out.
    const tpBest = getTimePressureBest();
    section.appendChild(buildModeCard({
      accent: TIME_PRESSURE_ACCENT,
      icon: Icons.clock(20),
      name: 'Time pressure',
      // The subtitle carries the rules, because they ARE the exercise.
      sub: '20 seconds a position, 2 minutes',
      stat: tpBest > 0 ? tpBest : undefined,
      statLabel: tpBest > 0 ? 'best' : undefined,
      disabled: refs.length === 0,
      disabledReason: noneReason,
      onClick: () => startTimePressure(),
    }));

    for (const cat of CATEGORIES) {
      const pool = refs.filter(r => r.spot.category === cat);
      section.appendChild(buildModeCard({
        accent: CATEGORY_ACCENT[cat],
        icon: CATEGORY_ICON[cat](),
        name: CATEGORY_LABEL[cat],
        sub: CATEGORY_SUB[cat],
        stat: pool.length > 0 ? counts.unfixedByCategory[cat] : undefined,
        statLabel: pool.length > 0 ? 'to fix' : undefined,
        disabled: pool.length === 0,
        disabledReason: noneReason,
        onClick: () => startSession(pool, cat),
      }));
    }

    // Your brilliant moves — the flip side of the mistake cards. Nothing waiting
    // means they have all been re-found lately, which is a result rather than an
    // empty card, so it stays tappable and the subtitle says why the badge went.
    section.appendChild(buildModeCard({
      accent: CLASS_COLOR.brilliant,
      icon: classIcon('brilliant', 20),
      name: 'Your brilliant moves',
      sub: brilliantRefs.length > 0 && gemsReady === 0
        ? 'all found — they come back over the next few days'
        : gemsOnly ? 'find your brilliancies again' : 'find your best moves again',
      stat: gemsReady > 0 ? gemsReady : undefined,
      statLabel: gemsReady > 0 ? 'to find' : undefined,
      disabled: brilliantRefs.length === 0,
      disabledReason: noneReason,
      onClick: () => startBrilliant(brilliantRefs),
    }));

    // The Fixed list — spots already put right, and the way back into any of
    // them. It opens a sheet, so it costs one card rather than a section.
    if (counts.fixed > 0) {
      section.appendChild(buildModeCard({
        accent: MIDDLEGAME_ACCENT,
        icon: Icons.checkCircle(20),
        name: 'Fixed',
        sub: 'the ones you have already put right',
        stat: counts.fixed,
        statLabel: 'fixed',
        onClick: () => openFixed(),
      }));
    }

    return box;
  }

  // The Fixed list, and the way back into any of it: a row (or the button at the
  // top) hands spots straight to the same drill the category cards use.
  function openFixed(): void {
    openFixedSheet({
      refs: refs.filter(r => r.spot.fixed),
      onTrain: (deal) => {
        if (deal.length === 0) return;
        startMistakeSession({
          refs: deal,
          modeLabel: 'Mistakes to fix',
          contextLabel: 'Fixed again',
          modeAccent: CATEGORY_ACCENT.blunder,
          onExit: rerender,
          onOpenGame: deps.onOpenGame,
        });
      },
    });
  }

  function startDetective(count = DETECTIVE_SESSION): void {
    const refsForRun = pickDetective(detectiveRefs, count, detectiveDueAt());
    if (refsForRun.length === 0) return;
    startDetectiveSession({
      refs: refsForRun,
      onExit: rerender,
      onPlayAgain: () => startDetective(count),
      onOpenGame: deps.onOpenGame,
    });
  }

  function startWhichMove(count = WHICH_MOVE_SESSION): void {
    const refsForRun = pickWhichMove(pairRefs, count, whichMoveDueAt());
    if (refsForRun.length === 0) return;
    startWhichMoveSession({
      refs: refsForRun,
      onExit: rerender,
      onPlayAgain: () => startWhichMove(count),
      onOpenGame: deps.onOpenGame,
    });
  }

  // Time pressure deals from EVERY mistake, ordered by how little time was on
  // your clock (time-pressure.ts). It deliberately ignores the rest logs the
  // other exercises consult: a three-minute round gets through twenty-odd
  // positions, and a pool filtered down to what is "due" would run dry in a
  // week. For the same reason it files no rest and marks nothing fixed — see
  // the note at the top of time-pressure.ts.
  function startTimePressure(): void {
    const round = dealRound(refs);
    if (round.length === 0) return;
    startTimePressureSession({
      refs: round,
      onExit: rerender,
      onPlayAgain: () => startTimePressure(),
      onOpenGame: deps.onOpenGame,
    });
  }

  function startBrilliant(pool: BrilliantRef[], count = SESSION_SIZE): void {
    // Re-order against the rest log as it stands NOW rather than reusing the
    // ordering the pane was painted with: the gems this sitting just re-found
    // have gone to rest since, and "Play again" that deals the same five gems
    // back is the same complaint as a repeated blunder.
    const due = brilliantDueMap();
    const ordered = orderBrilliant(pool, id => due[id] ?? 0);
    startBrilliantSession({
      refs: ordered.slice(0, count),
      onExit: rerender,
      onPlayAgain: () => startBrilliant(pool, count),
      onOpenGame: deps.onOpenGame,
    });
  }

  function startSession(pool: SpotRef[], cat: MistakeCategory): void {
    startMistakeSession({
      // Fresh each time, so "Play again" deals what you haven't just done —
      // including what another exercise dealt you a minute ago.
      refs: pickSpots(pool, cat, SESSION_SIZE, spotDueAt()),
      modeLabel: CATEGORY_LABEL[cat],
      modeIcon: () => CATEGORY_ICON[cat](18),
      modeAccent: CATEGORY_ACCENT[cat],
      onExit: rerender,
      onPlayAgain: () => startSession(pool, cat),
      onOpenGame: deps.onOpenGame,
    });
  }
}
