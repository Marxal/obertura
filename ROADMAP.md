# Obertura v1.1 roadmap

This file tracks the v1.1 refinement round. Tasks are added here as they
are defined and checked off as they land.

## What v1.1 builds

v1.1 is a focused refinement pass on top of the feature-complete v1.0
baseline. No new data model changes; no backend. The goal is a polished,
daily-driveable app.

### Theming + dark mode
New design tokens, a proper colour palette, and a dark-mode toggle that
persists across sessions.

### Bottom-tab navigation + Home screen
Replace the current tab bar with a bottom-navigation component that matches
mobile conventions. Add a Home screen with a quick-start summary (lines due,
last trained, shortcut into training).

### Redesigned My Lines (carousel)
Replace the flat list with a card carousel so lines feel browsable and
discoverable on a phone screen.

### Builder fixes
- Auto board-flip when colour is set to Black.
- Opening names bundled locally (no live API call needed during build).
- Tag management on lines.
- Step-back / step-forward arrows in the move list.

### Four training modes
1. Full line — play the whole line from start.
2. Individual moves — quiz one move at a time.
3. Choose what to practice — filter by tag, colour, or due date.
4. Timed — play under a clock for pressure training.

### Statistics screen + repertoire map
A dedicated Stats tab showing accuracy over time, move heatmaps, and a
tree-map view of the full repertoire.

### Backup export / import
One-tap JSON export of the full repertoire and a matching import so the
user can back up to Google Drive or share between devices manually.

---

*Last updated: 2026-06-08 — roadmap created, tasks pending breakdown.*
