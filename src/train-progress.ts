// The Train screen's rated doors show the way to the next hundred of the rating
// as the ring round their icon (train-doors.ts). Pure, so it is tested under
// plain Node (train-progress.selftest.ts).

/**
 * The next round hundred above a rating, and how far through the current
 * hundred it is — the progress a rated door shows. 1437 → 37 of 100, "63 pts
 * to 1500". A rating exactly on a hundred has the whole next hundred to go.
 */
export function ratingProgress(rating: number): { value: number; max: number; label: string } {
  const r = Math.max(0, Math.round(rating));
  const next = Math.floor(r / 100) * 100 + 100;
  return { value: r - (next - 100), max: 100, label: `${next - r} pts to ${next}` };
}
