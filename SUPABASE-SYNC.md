# Accounts and sync — the Supabase setup (no code)

Everything a Bito Chess account does lives in one Supabase project: who you are,
whether you've paid, and the copy of your data that lets a new phone pick up
where the old one left off. The app can't create any of it — that's a handful of
settings and one table, made once, by pasting SQL into a web page and flipping
switches in a dashboard.

This file is the whole checklist. Work through it top to bottom on a new project;
on an existing one, jump to whatever section you haven't done — every step here
is safe to repeat.

Until it exists, everything else keeps working: the repertoire lives on the phone
as always, and the Account section reports what's missing rather than syncing.

---

## 1. The table

One row per user, holding the copy of their data.

| column                     | type          | what it holds                                            |
| -------------------------- | ------------- | -------------------------------------------------------- |
| `id`                       | `uuid`        | the user's auth id (the row's key)                       |
| `repertoire`               | `jsonb`       | your lines **and** your stats/streaks/settings            |
| `repertoire_updated_at`    | `timestamptz` | when that half was last pushed — **the sync reads this**  |
| `games`                    | `jsonb`       | your imported games                                       |
| `games_updated_at`         | `timestamptz` | when the games were last pushed — **the sync reads this**  |
| `entitled`                 | `boolean`     | has this account paid? Gates the training cap             |
| `entitled_at`              | `timestamptz` | when the purchase webhook granted it (a record only)      |
| `stripe_customer_id`       | `text`        | the Stripe customer behind that purchase (a record only)  |
| `stripe_payment_intent_id` | `text`        | the Stripe payment itself (a record only)                 |

**`repertoire` is badly named and it's staying that way.** It was drafted when
lines were the only thing that synced; it now carries the lines *plus* the
app-state snapshot (statistics, streaks, puzzle ratings, endgame progress,
preferences). Renaming it would be a migration for no visible gain. Don't read
the name as a description.

**The two `_updated_at` columns are not decoration.** They are how a second
device finds out anything has happened. The app asks for those two timestamps —
a few hundred bytes — and downloads a blob only when one of them has moved since
it last looked. Without them the app would have to fetch up to 8 MB to discover
that nothing had changed.

**Why games sit in their own column.** A game carrying a saved analysis costs
about 18 KB against 1.4 KB bare, so a thousand games with analyses is 4–20 MB
while the lines-and-settings half stays under 4 MB. When it was all one column,
changing a single move re-uploaded every game you own — on mobile data, and
rewriting the whole value in Postgres each time. Split in two, an edit sends the
small half, and games go up only when games actually change.

**What the games column deliberately leaves out.** Saved analyses and
mistake-scan results are stripped before upload, and only the most recent 500
games go up at all. Both are size decisions with the same reasoning: an analysis
tree and a scan's spots are engine *output*, recomputable on any device from the
moves that do sync, and together they were ~80% of every games upload. They stay
on the device that made them and in the manual backup file — a user-controlled
export follows different rules from a shared, quota-bearing database row. The
fingerprint is taken over the slimmed payload, so analysing or scanning a game
costs no upload at all. See `src/sync-core.ts`.

`entitled` is the free tier's switch: false (the default) caps the account at 10
lines in training at once, true lifts the cap. The app only ever READS it. Two
things write it: your own hand in the dashboard, and the Stripe purchase webhook
(`worker/stripe-webhook.ts`, set up in STRIPE-SETUP.md), which sets it together
with `entitled_at` and the two `stripe_` columns.

**Nothing reads the other three.** They are there so a row can answer "when did
this account get access, did a purchase or a human do it, and which Stripe
payment was it?" without searching the Stripe dashboard by email. A refund sets
`entitled` back to false and leaves all three alone — the timestamp records when
access was granted, and a refund doesn't unhappen that.

**There is deliberately no `subscription_status` column.** Bito Chess sells a
one-time unlock, and a boolean is the honest shape for "has this account paid?".
A status enum would imply renewals, dunning and a grace period, none of which
exist. If a subscription is ever introduced, that is the moment to add it.

**It needs a column-level revoke, not just RLS.** The update policy below is
row-scoped, not column-scoped — on its own it lets a signed-in user update *any*
column of their own row, `entitled` included, straight from the browser with the
public anon key. Postgres column privileges are what actually stop that, so the
SQL revokes UPDATE on `entitled` and re-grants it only on the four sync columns.

### The SQL

Open <https://supabase.com/dashboard> → the Bito Chess project → **SQL Editor**
→ **New query**, paste all of this, press **Run**. It should say "Success".

```sql
-- One row per user. The row's id IS the auth user's id, so a user can only
-- ever have one, and it disappears with the account.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  repertoire jsonb,
  repertoire_updated_at timestamptz,
  games jsonb,
  games_updated_at timestamptz,
  entitled boolean not null default false,
  entitled_at timestamptz,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

-- Safe to re-run on a project made before any of these existed.
alter table public.profiles
  add column if not exists entitled boolean not null default false,
  add column if not exists entitled_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists games jsonb,
  add column if not exists games_updated_at timestamptz;

-- Row-level security: without this, the public anon key in the app bundle
-- would let anyone read everyone's rows. With it, every query is silently
-- filtered to the signed-in user's own row — which is what makes shipping
-- that key in the JavaScript safe.
alter table public.profiles enable row level security;

-- Dropped first so the whole block can be re-run on an existing project without
-- erroring on "policy already exists" — which would abort everything after it,
-- including the grants at the bottom.
drop policy if exists "own profile: read" on public.profiles;
create policy "own profile: read"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "own profile: insert" on public.profiles;
create policy "own profile: insert"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "own profile: update" on public.profiles;
create policy "own profile: update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Deleting an account goes through the Worker with the service_role key (see
-- §5), which bypasses RLS — so there is deliberately NO delete policy for the
-- browser. A stray request from the app can never remove a row.

-- The policy above is row-scoped, not column-scoped: without the next lines it
-- would let any signed-in user flip their own `entitled` to true from the
-- browser. Column privileges are the fix — take UPDATE away wholesale, then hand
-- it back only on the four columns the sync actually writes.
--
-- This revoke is also exactly why the purchase webhook needs the service_role
-- key rather than the anon key: `service_role` is not named here, so it keeps
-- its UPDATE on `entitled` and bypasses RLS entirely. The browser can never
-- write the flag; only the server can.
--
-- A column added later is not in either grant list, so it starts out unwritable
-- by the browser. Protection by default rather than by remembering.
revoke update on public.profiles from anon, authenticated;
grant update (repertoire, repertoire_updated_at, games, games_updated_at)
  on public.profiles to authenticated;
grant insert (id, repertoire, repertoire_updated_at, games, games_updated_at)
  on public.profiles to authenticated;

-- ── THE SIZE CEILING, ENFORCED WHERE IT CAN'T BE ARGUED WITH ────────────────
-- The app refuses to push a column over 4 MB (SYNC_PART_LIMIT_BYTES in
-- src/sync-core.ts) and tells the user why. That check lives in JavaScript the
-- user is holding, so it is a courtesy, not a control: anyone willing to open
-- devtools can send whatever they like with their own anon key and RLS would
-- wave it through. This trigger is the version that actually holds.
--
-- 4 MB per column is roughly six times the biggest payload the app can produce
-- — about 1,600 lines, or 500 games — so reaching it means something is wrong
-- rather than that someone has been busy. See §7.
create or replace function public.profiles_size_guard()
returns trigger
language plpgsql
as $$
begin
  if new.repertoire is not null
     and pg_column_size(new.repertoire::text) > 4 * 1024 * 1024 then
    raise exception 'repertoire column is over the 4 MB limit';
  end if;
  if new.games is not null
     and pg_column_size(new.games::text) > 4 * 1024 * 1024 then
    raise exception 'games column is over the 4 MB limit';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_size_guard on public.profiles;
create trigger profiles_size_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_size_guard();
```

**Already ran an earlier version of this block?** Paste it again as-is. Every
statement is either `if not exists`, a drop-then-create, or a grant that restates
itself, so a re-run adds whatever is missing and leaves everything else exactly
as it was. Your existing synced data is untouched, and so is every account's
`entitled` flag.

---

## 2. Email confirmation

**Turn it on.** It was off, and that was a mistake: without it anyone can
register `marcal@gmial.com`, get an account, buy the unlock, and then have no way
to reach the account — no password reset, no receipt, nothing. Confirmation costs
one click and makes the address real before anything is attached to it.

**Authentication → Sign In / Providers → Email**

- **Confirm email**: ON.
- **Minimum password length**: 8. (Supabase's default is 6; the app's own error
  text follows whatever you set here.)
- **Prevent use of leaked passwords**: ON. It checks new passwords against Have
  I Been Pwned's k-anonymity API. Free, one toggle, and it stops the single most
  common way an account gets taken.

### The redirect allow-list

**Authentication → URL Configuration**

- **Site URL**: `https://bitochess.com/app/`
- **Redirect URLs**: add every origin the app is served from, or the links in
  the emails will bounce with "requested path is invalid":
  - `https://bitochess.com/app/`
  - `http://localhost:5173/` (whatever `npm run dev` prints)

The app always sends the same string — its own origin plus its base path — so
these two are the whole list. See `authRedirectUrl()` in `src/auth.ts`.

### The email templates — one edit each, and it matters

**Authentication → Emails → Templates**

By default Supabase's templates link to `{{ .ConfirmationURL }}`, which comes
back to the app as `?code=…`. A `?code=` can only be redeemed by the browser that
started the flow, because only that browser holds the PKCE verifier — which is
exactly wrong for an email, since **mail gets opened wherever mail gets opened**.
Tap the link in Gmail on your phone and it opens in Gmail's own in-app browser,
which has never heard of the verifier, and the confirmation fails.

`token_hash` has no such requirement. Edit these three templates:

**Confirm signup** — replace the link's `href` with:

```
{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=signup
```

**Reset password** — replace the link's `href` with:

```
{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery
```

**Magic Link** — replace the link's `href` with:

```
{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=magiclink
```

This is the one the sign-in tab's **"Send me a sign-in link"** sends, and it is
the template that matters most for this shape: a sign-in link is opened from a
phone's mail app more reliably than anything else in this document. The Email
provider is on already (it's what password sign-in uses), so nothing needs
enabling — only the template edited. (Change Email takes `type=email_change` the
same way, if you ever use it.)

The app handles both shapes — `token_hash` and the old `?code=` — so nothing
breaks while the templates are still the defaults. It just works in fewer places.

### ⚠️ SMTP: the built-in mailer will not do

**This is the step that bites.** Supabase's default email service is for testing
only and is rate-limited to a handful of messages **per hour, across the whole
project**. With confirmation on and the built-in sender, the fourth person to
register today simply never gets an email — and there is no error anyone sees.

**Authentication → Emails → SMTP Settings** → set up a custom sender. Free
options that need no card:

| service   | free tier                    | notes                                    |
| --------- | ---------------------------- | ---------------------------------------- |
| **Resend**| 3,000/month, 100/day         | Simplest to set up; one domain to verify |
| **Brevo** | 300/day                      | No domain needed to start                |
| **Mailgun** / **Postmark** | trial only  | Both want a card eventually              |

Resend is the one to pick. Verify `bitochess.com`, add the DNS records it gives
you, paste its SMTP host/user/password into Supabase, and set the sender to
something like `Bito Chess <hello@bitochess.com>`.

Then raise **Authentication → Rate Limits → Email sent** from the default (2/hour
on the built-in sender) to something sane like 30/hour.

---

## 3. Sign-in providers

The app shows a button per provider named in one build-time variable:

```
VITE_AUTH_PROVIDERS=google,facebook,apple
```

Unset means `google` alone. **A provider named here that isn't also enabled in
the dashboard produces a button that fails** with "Unsupported provider", so the
two are changed together: enable it in Supabase, then add it to the variable in
the Cloudflare Pages settings, then redeploy.

Every provider needs the same callback URL, which Supabase shows you on its own
settings page:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

### Google — already on

Nothing to do.

### Facebook — free, about twenty minutes

1. <https://developers.facebook.com> → **My Apps** → **Create App** → type
   **Consumer** (or "Authenticate and request data from users with Facebook
   Login" on the newer flow).
2. Add the **Facebook Login** product. Under its Settings, put the Supabase
   callback URL above into **Valid OAuth Redirect URIs**.
3. **App settings → Basic**: copy the **App ID** and **App Secret**.
4. Supabase → **Authentication → Sign In / Providers → Facebook**: paste both,
   enable.
5. Add `facebook` to `VITE_AUTH_PROVIDERS` and redeploy.

The one catch: a Facebook app starts in **Development mode**, where only you and
accounts you add as testers can sign in. Going Live needs a privacy-policy URL
(you have one: `https://bitochess.com/privacy.html`) and, for the `email`
permission, Meta's **App Review** — usually a few days, and free. Until it's
approved, leave `facebook` out of the variable.

### Apple — works, but it costs $99/year

Sign in with Apple needs a **paid Apple Developer Program membership**
(US$99/year). There is no free path: the Services ID and the signing key that
Supabase needs are both behind it. **Flagging this because it's the only item in
this whole document that costs money.**

If you want it anyway:

1. Apple Developer → **Certificates, Identifiers & Profiles**.
2. **Identifiers** → new **App ID** (your bundle id, e.g. `com.bitochess.app`),
   then a new **Services ID** (e.g. `com.bitochess.web`) with Sign in with Apple
   enabled. Its "Return URL" is the Supabase callback above.
3. **Keys** → new key with Sign in with Apple enabled. Download the `.p8` — you
   get one chance at it — and note the Key ID and your Team ID.
4. Supabase → **Authentication → Sign In / Providers → Apple**: Services ID as
   the client id, then the Team ID, Key ID and the `.p8` contents.
5. Add `apple` to `VITE_AUTH_PROVIDERS` and redeploy.

Worth knowing before you spend it: Apple only sends the user's name on the *very
first* sign-in, and its "Hide My Email" relay means the address in `profiles` may
be a forwarding one. Neither breaks anything here (the app uses the email as a
label, not as a key), but they surprise people.

### Lichess and Chess.com — not possible as sign-in, and here's exactly why

**Lichess.** Lichess does have OAuth2 (PKCE, no client secret — genuinely nice),
and the app already uses it: Settings → Lichess connection, `src/lichess-auth.ts`.
But Supabase's `signInWithOAuth` only accepts providers from its own fixed list,
and Lichess isn't on it. Supabase also has no "generic OIDC provider" option on
the hosted platform, and Lichess is OAuth2 rather than OIDC — it issues no
`id_token`, which is what `signInWithIdToken` would need. So there is no
supported way to make "Sign in with Lichess" create a Supabase account.

The honest workaround, if it ever matters, is a Worker endpoint that completes
the Lichess flow itself and then mints a Supabase session with the service-role
key. That is a real piece of security-sensitive server code — token exchange,
account linking, protection against binding someone else's Lichess handle to your
account — and it is not worth building for a sign-in button.

**What you can do instead, cheaply:** the connection already exists, so offer it
right after sign-in ("Connect your Lichess account") rather than as sign-in
itself. Same end state — the Lichess library is available — with none of the
above.

**Chess.com.** No public OAuth at all. Chess.com's Published-Data API is
read-only and unauthenticated (which is exactly how the app imports games today,
by username); their OAuth programme has never opened to general developers.
There is nothing to configure, at any price.

---

## 4. Turning on full access for an account

Table Editor → `profiles` → find the row by `id` → tick `entitled` → save. The
app picks it up on the next launch or sign-in (it re-reads the flag once per
sign-in, then caches it for offline use).

---

## 5. Deleting an account

Settings → Data → **Delete your account** removes the account for good. It can't
be done from the browser: the account is a row in `auth.users`, which no browser
key may touch, so the app asks the Worker (`worker/account-delete.ts`) and the
Worker does it with the service-role key.

It needs one Worker secret, which the Stripe webhook already uses:

```
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

(Plus `SUPABASE_URL` / `VITE_SUPABASE_URL` and the anon key, which are already
set for the checkout endpoint — see STRIPE-SETUP.md.)

The endpoint verifies the caller's access token with Supabase before it deletes
anything, so the id can only ever be the caller's own. It deletes the `profiles`
row and then the auth user; the `on delete cascade` on `profiles.id` would take
the row anyway, and doing it explicitly first means a failure halfway through
leaves an account with no synced copy rather than the other way round.

**What it does not do:** touch the phone, or refund a purchase. Both are
deliberate. The phone's data is the user's own, on their own device, so wiping it
is a separate tick-box on the same dialog (off by default). A refund is a
different request to a different place — the terms say so.

---

## 6. How the sync behaves

- **Reads always come from the phone.** IndexedDB stays the source of truth;
  Supabase holds a copy, never the working data.
- **Changes push about 30 seconds later**, so an editing burst is one upload.
  Only the half that changed goes: edit a line and the games stay put; import
  games and the lines stay put. A half whose contents are byte-for-byte what was
  last pushed isn't sent at all.
- **Changes pull automatically.** On sign-in, whenever the app comes back to the
  foreground, and every five minutes while it's open, it asks the account whether
  either half has moved since it last looked. That question is two timestamps;
  only a half that really has moved is downloaded. There is also a **Sync now**
  button in Settings → Account for when you don't want to wait.
- **A pull always merges, and never asks.** Signing in used to stop and ask
  "merge or replace?" — at the worst possible moment, with "merge" being the
  right answer every time, and with cancelling leaving the device silently
  unsynced for ever. Now:
  - **lines merge by move.** The two trees become one tree; on a move both sides
    have, the better review record survives. Nothing is ever deleted by a pull.
  - **games merge by id.**
  - **statistics and settings are last-write-wins**, decided by
    `repertoire_updated_at`. There is no sensible union of two streak counters.
    The device with unpushed changes of its own never has them overwritten — it
    pushes first and takes the account's copy on the next round.
- **Closing the app** inside the 30-second window pushes on the way out rather
  than waiting for the next launch. Best-effort — Android can kill a PWA before
  the request lands — so the next launch retries, which costs nothing when it
  turns out the push did get through.
- **Offline is fine.** The change is already saved on the phone; the Account
  section says so, and the next edit, foreground or launch tries again.
- **Signing out** leaves the account's copy alone and puts this device back to
  "not synced here". Signing back in pulls it down and merges it.
- **Erasing everything** can't reach the account's copy. The erase deliberately
  doesn't announce itself to the sync, and it also clears the signed-in session,
  so there's nothing to push and no way to push it. Sign back in afterwards and
  the copy comes back.

### The one thing merge can't do

**A deletion doesn't travel.** Delete a line on phone A, and phone B — which
still has it — hands it straight back on its next push. There is no way to tell
"deleted" from "hasn't arrived yet" without per-move tombstones, which is a real
piece of work parked in PUBLISHING.md.

The escape hatch is explicit rather than a prompt: **Settings → Data → "Replace
this device from your account"** throws away what's on this phone and takes the
account's copy exactly. Tidy up on one device, let it push, then run that on the
other. It's the old "replace" answer, asked for on purpose instead of guessed at.

### When something is wrong, the Account section now says what

The caption used to read "Sync failed — will retry" for everything, which made a
project whose SQL had never been run look exactly like a train tunnel. It now
names the cause: a missing table, a missing column, a blocked write, an expired
session, or simply being offline. If you see one of the first three, the fix is
always the same — re-run §1's SQL.

---

## 7. How much can one account store?

Measured, not guessed (`scripts/` has no permanent home for this; the numbers
below come from generating synthetic trees of realistic shape and size).

**Per line: about 2.1–2.7 KB** inside the tree, review records included. Sibling
lines share their opening moves, so the tree is cheaper than "lines × 2.5 KB"
suggests at small counts and settles near it as the repertoire widens.

**Per synced game: about 1.4 KB**, with the analysis and mistake-scan stripped.

| what                        | raw JSON | as Postgres stores it |
| --------------------------- | -------- | --------------------- |
| 10 lines                    | 0.02 MB  | ~0.01 MB              |
| 100 lines                   | 0.20 MB  | ~0.04 MB              |
| 500 lines                   | 1.17 MB  | ~0.28 MB              |
| 1,000 lines                 | 2.56 MB  | ~0.63 MB              |
| 1,600 lines                 | 3.85 MB  | ~0.84 MB              |
| the app-state snapshot      | ~0.13 MB | ~0.03 MB              |
| 500 games (the sync's cap)  | 0.68 MB  | ~0.20 MB              |

(`jsonb` over about 2 KB is TOASTed and compressed; the right-hand column is a
gzip stand-in for that, which is a fair proxy on data this repetitive.)

**So the 4 MB ceiling on the `repertoire` column falls at roughly 1,600 lines**,
snapshot included. The games column cannot reach its ceiling at all: the 500-game
cap puts it at 0.68 MB, about a sixth of the limit.

**In plain terms.** A serious repertoire is 100–300 lines. A very serious one,
built over years across several openings, is 500–800. 1,600 is past the point
where a human can train what they have. Nobody reaches this by using the app
properly — reaching it means something has gone wrong, which is exactly why the
limit tells the user rather than failing silently, and why the trigger in §1
exists to enforce it against a client that has been tampered with.

**And the free project overall.** Supabase's free tier gives 500 MB of database,
5 GB of egress a month, and 50,000 monthly active users.

- A typical user (150 lines, 200 games) stores about **0.13 MB**. That's roughly
  **3,800 users** in 500 MB.
- A worst-case user at both ceilings stores about **1.05 MB** — roughly **475**
  of those would fill it, and there is no way to have 475 of them.
- Egress is the one to watch, and the pull loop is built around it: the routine
  question costs two timestamps (a few hundred bytes), so a phone left open all
  day costs well under 100 KB. Blobs only come down when the other device has
  actually been busy.

The realistic first constraint is neither: it's the 50,000 monthly active users,
and that is a very good problem to have.

---

## 8. Keeping the free project awake

Supabase pauses a free project after about a week with no activity, and only a
click in the dashboard brings it back. `.github/workflows/supabase-keepalive.yml`
prevents that: every three days it asks the REST API for one row of `profiles`
and throws the answer away. Row-level security means the anon key sees nothing —
that's the point, the query itself is the heartbeat.

It needs two repository secrets, under **Settings → Secrets and variables →
Actions** on GitHub:

- `SUPABASE_URL` — `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY` — the public anon key, the same one the app ships. Never
  the `service_role` key.

Nothing else depends on this workflow, so a failed ping breaks nothing; GitHub
emails you about the failed run, which is all the alerting it needs. Run it by
hand any time from **Actions → Supabase keepalive → Run workflow**.

---

## 9. The checklist, in one place

- [ ] §1 SQL run (table, RLS, grants, size trigger)
- [ ] §2 Confirm email ON, minimum password length 8, leaked-password check ON
- [ ] §2 Site URL and Redirect URLs set
- [ ] §2 All three email templates switched to `token_hash` — Confirm signup,
      Reset password and **Magic Link**
- [ ] §2 **Custom SMTP configured** — without it, confirmation emails stop after
      a couple per hour
- [ ] §2 Email rate limit raised
- [ ] §3 `VITE_AUTH_PROVIDERS` set in Cloudflare Pages to match what's enabled
- [ ] §5 `SUPABASE_SERVICE_ROLE_KEY` set as a Worker secret
- [ ] §8 Keepalive secrets set on GitHub
