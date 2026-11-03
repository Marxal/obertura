// Had this device trained before this launch? Read once at boot from what the app
// keeps anyway, so "used the app" can count a first time with nothing stored for it.
// It has to be read at boot: when a training event fires, its result is already saved.

import { getDailyLog } from './daily-recap';
import { getEndgameProgress } from './endgame-progress';
import { setUsedBefore } from './metrics';
import { getMistakeDrillsDone } from './mistake-scan';
import { getPuzzleDays } from './puzzle-log';
import { getTrainingDays } from './streak';

export function readFirstUse(): void {
  try {
    setUsedBefore(
      getTrainingDays().length > 0
        || getPuzzleDays().some((d) => d.solved > 0)
        || getDailyLog().some((d) => d.done)
        || Object.values(getEndgameProgress()).some((r) => r.solved)
        || getMistakeDrillsDone() > 0,
    );
  } catch {
    // Unreadable, so don't claim a first time. A count is never worth a wrong one.
    setUsedBefore(true);
  }
}
