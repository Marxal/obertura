# Connecting Lichess and Chess.com — what OAuth is for, and what it isn't

Parked notes, September 2026. Nothing here is built beyond what already ships
(`src/lichess-auth.ts`). This file exists so the research isn't repeated and so
the one genuinely settled decision — **platform OAuth is for connecting, never
for creating Bito accounts** — doesn't quietly get re-opened.

---

## 1. The decision

**Connecting a chess platform and creating a Bito Chess account are two
different things, and they stay separate.**

Platform OAuth (Lichess today, Chess.com if approved) exists to answer *"who are
you on that site?"* so the app can fetch the right games and unlock the
logged-in-only features. It is **not** a route to provisioning an account.

Account creation is already solved: **Google sign-in is connected**, with
Facebook a possible addition. That is the one-tap free account, it needs no
email typed, and it needs no confirmation mail because the provider has already
verified the address. Nothing about a chess platform improves on that.

### Why the "harvest the email, auto-register" idea was dropped

The idea: Lichess exposes the account's email via the `email:read` scope, so
take it and silently create the free account. Rejected for four reasons, kept
here so it isn't proposed again:

1. **An email from Lichess doesn't prove control of that inbox.** It is whatever
   the user typed into Lichess. Provisioning a Bito account on it means someone
   could have an account created on another person's address.
2. **Supabase's confirm-email flow exists to prevent exactly that.** Bypassing it
   requires the `service_role` key, which means the Worker gains the power to
   mint accounts — a large security surface bought for a small convenience.
3. **It isn't consent.** An account means agreeing to the terms and the privacy
   policy, and that policy currently promises an account is *strictly optional*.
   Silent provisioning contradicts it.
4. **It collides.** The same person later signing up with Google on that address
   produces a conflict nobody asked for.

Email pre-fill (get the address, pre-populate our own sign-up form, still
verify) was the safe middle option. Also dropped — with Google connected there
is nothing left for it to save.

---

## 2. What connecting actually buys, per platform

### Lichess — already built, and the reason to care

`src/lichess-auth.ts` runs the full OAuth flow today, requesting a **single
scope: `puzzle:read`**.

Connecting unlocks real features (the wording in `first-steps.ts`): **the live
opening explorer, the user's puzzle history, and a stronger engine.**

The explorer is the interesting one. Per `CLAUDE.md`, the live Lichess explorer
API is **login-gated nowadays**, so it is only ever an optional logged-in
overlay on the Library slide and never a dependency — opening *names* come from
the bundled CC0 dataset in `src/openings.ts`. That makes "connect Lichess" the
only way a user reaches the live library, which is the strongest standing reason
to surface the connection prominently.

Other scopes exist and are **not** requested: `email:read` (with
`GET /api/account/email`) returns the account's email. Deliberately unused — see
§1.

### Chess.com — public API covers the data; OAuth would only smooth the first run

The **Published-Data API needs no authentication at all** and already provides
games, ratings and profile, keyed by username
(`api.chess.com/pub/player/{username}`). Everything the app does with Chess.com
data works today with a typed username.

What OAuth would add is purely onboarding: replacing "remember and correctly
type your handle" with one tap. That is a real drop-off point, but it is a
convenience, not a capability.

**There is no email→username lookup on either platform**, and there never will
be — it is a user-enumeration hole. Chess.com staff have declined it repeatedly
in their own forums. Any flow that starts "the user gives us an email, we find
their chess account" is a dead end.

---

## 3. The Chess.com OAuth application

Applying is free and costs nothing to have pending, so the form was submitted to
find out what is actually on offer.

- **Apply:** <https://forms.gle/RwGLuZkwDysCj2GV7>
- **Docs:** <https://chesscom.notion.site/Getting-started-with-Chess-com-OAuth-2-0-Server-5958e57c8c934a3aa7abda2d670969e8>
  — a JS-rendered Notion page; it cannot be fetched by a scraper and has to be
  opened in a browser.
- **Developer community:** the Chess.com Developer Community club, where the
  OAuth guides live.

**The scope list is not documented anywhere publicly reachable.** What Chess.com
states publicly is only that OAuth lets an application "obtain a user's
Chess.com username without the user sharing their password". Whether an email
scope exists is **unknown** — the application asks them directly. Do not assume
one until they answer.

**Approval is not a blocker for anything.** Chess.com import works today via the
username field. If OAuth is approved it becomes a tap instead of typing; if the
answer never comes, nothing is lost.

---

## 4. If this is ever picked up again

- A true *"Sign in with Lichess"* — Lichess as an identity provider for Supabase
  — was considered and rejected as the most work for the least gain. Supabase
  has no native Lichess provider, so it would need the Worker verifying a
  Lichess token and minting a Supabase session with `service_role`. Google
  sign-in already delivers the outcome.
- The OAuth redirect **reloads the app**, which is why
  `obertura.lichessReturnTo` exists. Any flow that puts a connection mid-way
  through a multi-step journey has to survive that reload — see the games-first
  onboarding round, where it is a live constraint rather than a theoretical one.
