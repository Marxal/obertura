// A runnable check of the IndexedDB storage layer — the real database, no mocks,
// no test framework. Surfaced in Settings → Diagnostics so the save/load/delete
// path can be verified right on the phone. It writes ONE throwaway line under a
// clearly-namespaced id and always deletes it again (even on failure), so it
// never touches the real repertoire.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { saveLine, getLine, getAllLines, deleteLine } from './storage';
import type { TestResult } from './selftest-panel';

// A small but representative line: two-ply tree, a note, tags, and a move review
// carrying a real Date — the bit most likely to break across a clone round-trip.
function sampleLine(id: string): Line {
  const reply: MoveNode = { id: 'n2', san: 'e5', uci: 'e7e5', fen: 'fen-e5', children: [] };
  const first: MoveNode = {
    id: 'n1',
    san: 'e4',
    uci: 'e2e4',
    fen: 'fen-e4',
    note: 'grab the centre',
    children: [reply],
    review: { ease: 2.5, interval: 6, reps: 2, lapses: 1, due: new Date('2026-09-01T08:00:00.000Z') },
  };
  const root: MoveNode = { id: 'root', san: '', uci: '', fen: 'start', children: [first] };
  return {
    id,
    name: 'Self-test line',
    tags: ['selftest', 'temp'],
    colour: 'black',
    openingName: "King's Pawn Game",
    confidence: 3,
    lastTrained: '2026-08-30',
    inTraining: true,
    tree: root,
    createdAt: 1_725_000_000_000,
  };
}

export async function runStorageSelfTest(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  const id = `__selftest__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const original = sampleLine(id);
  const originalDue = original.tree.children[0].review!.due.getTime();

  try {
    // 1. A saved line reloads field-for-field, tree and all.
    await saveLine(original);
    const loaded = await getLine(id);
    const tags = loaded?.tags.join(',') ?? '';
    check(
      'a saved line reloads with its fields and move tree intact',
      !!loaded &&
        loaded.name === original.name &&
        loaded.colour === 'black' &&
        loaded.confidence === 3 &&
        loaded.inTraining === true &&
        loaded.openingName === "King's Pawn Game" &&
        tags === 'selftest,temp' &&
        loaded.tree.children[0]?.uci === 'e2e4' &&
        loaded.tree.children[0]?.note === 'grab the centre' &&
        loaded.tree.children[0]?.children[0]?.san === 'e5',
      loaded ? `name="${loaded.name}", ${loaded.colour}, tags=[${tags}]` : 'getLine returned undefined',
    );

    // 2. The move review survives the round-trip, with `due` still a real Date.
    const rev = loaded?.tree.children[0]?.review;
    check(
      'a move review round-trips, due stays a Date',
      !!rev &&
        rev.due instanceof Date &&
        rev.due.getTime() === originalDue &&
        rev.ease === 2.5 &&
        rev.reps === 2 &&
        rev.lapses === 1,
      rev
        ? `due=${rev.due instanceof Date ? rev.due.toISOString() : String(rev.due)}, ease=${rev.ease}`
        : 'no review on the reloaded move',
    );

    // 3. getAllLines lists the freshly saved line.
    const all = await getAllLines();
    check(
      'getAllLines includes the saved line',
      all.some(l => l.id === id),
      `${all.length} line(s) stored`,
    );

    // 4. deleteLine removes it: getLine is undefined and it's gone from the list.
    await deleteLine(id);
    const afterDelete = await getLine(id);
    const stillListed = (await getAllLines()).some(l => l.id === id);
    check(
      'a deleted line is gone (getLine undefined, absent from getAllLines)',
      afterDelete === undefined && !stillListed,
      `getLine=${afterDelete === undefined ? 'undefined' : 'present'}, inList=${stillListed}`,
    );
  } catch (err) {
    check('storage round-trip completed without throwing', false, err instanceof Error ? err.message : String(err));
  } finally {
    // Never leave the probe line behind, even if a check above threw mid-way.
    try {
      await deleteLine(id);
    } catch {
      /* already gone — nothing to clean up */
    }
  }

  return results;
}
