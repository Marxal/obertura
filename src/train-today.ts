// The Train screen's Today strip — the one row above the four doors that says
// how the habit is going, before anything asks you to start something.
//
// WHY IT EXISTS. Train was a menu and nothing else: twenty-odd ways to start an
// exercise and not one word about whether you have been doing any of them. The
// daily challenge on Home works because it closes a loop — a list, ticks, a
// streak — and this borrows the part of that loop that belongs to training as a
// whole rather than to the day's list: the streak, this week at a glance, and
// how much you have already done today.
//
// WHAT IT DELIBERATELY IS NOT. It is not a second daily challenge (that stays on
// Home, where it works), and it starts nothing. Three readouts, read in one
// glance; the doors below are the buttons.
//
// Pure reads of what streak.ts already records — no new state, nothing synced.

import { currentStreak, getTrainingDays, reviewedToday } from './streak';
import { lastSevenDays } from './train-progress';

export function buildTodayStrip(): HTMLElement {
  const streak = currentStreak();
  const reviewed = reviewedToday();
  const week = lastSevenDays(new Set(getTrainingDays()));

  const strip = document.createElement('section');
  strip.className = 'train-today';
  strip.setAttribute('aria-label', 'Your training this week');

  // The streak. Cold (greyed flame) at zero, so "start one today" reads as an
  // invitation rather than a telling-off.
  const streakEl = document.createElement('div');
  streakEl.className = 'train-today-streak' + (streak === 0 ? ' train-today-streak--cold' : '');
  const flame = document.createElement('span');
  flame.className = 'train-today-flame';
  flame.setAttribute('aria-hidden', 'true');
  flame.textContent = '🔥';
  streakEl.appendChild(flame);
  const streakText = document.createElement('div');
  streakText.className = 'train-today-streak-text';
  const streakNum = document.createElement('span');
  streakNum.className = 'train-today-num';
  streakNum.textContent = String(streak);
  streakText.appendChild(streakNum);
  const streakLabel = document.createElement('span');
  streakLabel.className = 'train-today-label';
  streakLabel.textContent = streak === 0 ? 'start a streak' : 'day streak';
  streakText.appendChild(streakLabel);
  streakEl.appendChild(streakText);
  strip.appendChild(streakEl);

  // The week: seven dots, filled on the days you trained, today ringed. A
  // streak is one number; the week is what shows whether it is a habit.
  const weekEl = document.createElement('ol');
  weekEl.className = 'train-today-week';
  const trainedCount = week.filter((d) => d.trained).length;
  weekEl.setAttribute('aria-label', `Trained ${trainedCount} of the last 7 days`);
  for (const d of week) {
    const li = document.createElement('li');
    li.className = 'train-today-day'
      + (d.trained ? ' train-today-day--on' : '')
      + (d.today ? ' train-today-day--today' : '');
    li.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('span');
    dot.className = 'train-today-dot';
    li.appendChild(dot);
    const initial = document.createElement('span');
    initial.className = 'train-today-initial';
    initial.textContent = d.initial;
    li.appendChild(initial);
    weekEl.appendChild(li);
  }
  strip.appendChild(weekEl);

  // Today's work so far.
  const todayEl = document.createElement('div');
  todayEl.className = 'train-today-count';
  const todayNum = document.createElement('span');
  todayNum.className = 'train-today-num';
  todayNum.textContent = String(reviewed);
  todayEl.appendChild(todayNum);
  const todayLabel = document.createElement('span');
  todayLabel.className = 'train-today-label';
  todayLabel.textContent = reviewed === 1 ? 'move today' : 'moves today';
  todayEl.appendChild(todayLabel);
  strip.appendChild(todayEl);

  return strip;
}
