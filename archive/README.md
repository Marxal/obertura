# Archive — history, not documentation

**Nothing in this folder describes today's code.** These files are kept because
they record decisions and investigations that were real at the time, and because
throwing away reasoning is worse than storing it. They are not maintained, and
they are not corrected when the code moves on.

**Do not read these unless you are explicitly asked to.** Reading them costs
tokens and, worse, they will confidently tell you things that stopped being true.
The live documentation is at the repo root — start from `CLAUDE.md`.

| File | What it was | Superseded by |
|---|---|---|
| `APP-CONTEXT-2026-08.md` | The exhaustive 3,173-line codebase snapshot, as it stood on 2026-08-19. It had drifted ~12 rounds behind by the time it was retired. | `APP-CONTEXT.md` at the root, rewritten as a short orientation map |
| `ROADMAP-history.md` | Every shipped round from `v1.0` through `v0.6d`, ending just before the Stripe migration. | `ROADMAP.md` at the root keeps the recent rounds and a one-line index of these |
| `AUDIT.md` | A read-only code audit from the v1.2 round. Every finding in it is tagged ✅ FIXED. | — |
| `BACKNAV-DIAGNOSIS.md` | The v1.3 investigation into the dead back gesture in training — a z-index fault where the guard dialog mounted beneath the drill overlay. Fixed. | — |
| `Obertura_Style_Guide.html` | A standalone visual style guide from the Obertura era. Nothing in the repo ever linked to it. | The design tokens in `src/theme.ts` / `src/appearance.ts` |
