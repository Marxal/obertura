// A position's numbers as small bars rather than a sentence.

import { wdlBar, type WdlCounts } from './wdl-bar';

function row(label: string, bar: HTMLElement, value: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'nr-fact';
  const name = document.createElement('span');
  name.className = 'nr-fact-label';
  name.textContent = label;
  const number = document.createElement('span');
  number.className = 'nr-fact-value';
  number.textContent = value;
  el.append(name, bar, number);
  return el;
}

/** A plain share of something. */
export function meterBar(pct: number): HTMLElement {
  const track = document.createElement('div');
  track.className = 'nr-meter';
  const fill = document.createElement('div');
  fill.className = 'nr-meter-fill';
  fill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  track.appendChild(fill);
  return track;
}

export function meterRow(label: string, pct: number, value = `${pct}%`): HTMLElement {
  return row(label, meterBar(pct), value);
}

/** Wins, draws and losses, with what they add up to. */
export function resultRow(label: string, counts: WdlCounts, value = `${counts.scorePct}%`): HTMLElement {
  return row(label, wdlBar(counts), value);
}

/** A figure with nothing to draw. */
export function valueRow(label: string, value: string): HTMLElement {
  return row(label, document.createElement('span'), value);
}

/** Names whose move the rows below describe. */
export function factHeading(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'nr-fact-heading';
  el.textContent = text;
  return el;
}

export function factList(rows: HTMLElement[]): HTMLElement {
  const list = document.createElement('div');
  list.className = 'nr-facts';
  list.append(...rows);
  return list;
}
