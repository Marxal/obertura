# Account sync — the one-time Supabase setup (no code)

Signing in keeps a copy of your repertoire in your account, so a new phone can
pick it up. The app can't create the place that copy goes — that's one table in
your Supabase project, made once by pasting some SQL into a web page. Five
minutes, free tier, no billing.

Until it exists, everything else keeps working: the repertoire lives in the
phone as always, and the Account section simply reports "Sync failed — will
retry" instead of syncing.

## What the app expects

A table called `profiles`, one row per user, with:

| column                  | type          | what it holds                                       |
| ----------------------- | ------------- | --------------------------------------------------- |
| `id`                    | `uuid`        | the user's auth id (the row's key)                  |
| `repertoire`            | `jsonb`       | your lines **and** your stats/streaks/settings       |
| `repertoire_updated_at` | `timestamptz` | when that half was last pushed                       |
| `games`                 | `jsonb`       | your imported games, with their analyses and scans   |
| `games_updated_at`      | `timestamptz` | when the games were last pushed                      |
| `entitled`              | `boolean`     | has this account paid? Gates the training cap        |

**`repertoire` is badly named and it's staying that way.** It was drafted when
lines were the only thing that synced; it now carries the lines *plus* the
app-state snapshot (statistics, streaks, puzzle ratings, endgame progress,
preferences). Renaming it would be a migration for no visible gain. Don't read
the name as a description.

**Why games sit in their own column.** A game carrying a saved analysis costs
about 18 KB against 1.3 KB bare, so a thousand games with analyses is 4–20 MB
while the lines-and-settings half stays at 0.2–1.3 MB. When it was all one
column, changing a single move re-uploaded every game you own — on mobile data,
and rewriting the whole value in Postgres each time. Split in two, an edit sends
the small half, and games go up only when games actually change: an import, a
saved analysis, a scan. Neither half is re-sent when its contents haven't
changed at all (the app keeps a fingerprint of what it last pushed).

`entitled` is the free tier's switch: false (the default) caps the account at 10
lines in training at once, true lifts the cap. The app only ever READS it. You
set it by hand in the dashboard today; the buy flow will set it from a
server-side webhook later.

**It needs a column-level revoke, not just RLS.** The update policy below is
row-scoped, not column-scoped — on its own it lets a signed-in user update *any*
column of their own row, `entitled` included, straight from the browser with the
public anon key. Postgres column privileges are what actually stop that, so the
SQL revokes UPDATE on `entitled` and re-grants it only on the two sync columns.
Same honest caveat as the beta gate: this is the real enforcement point, so it
belongs in the database and not in the bundle.

## Step by step

1. Open <https://supabase.com/dashboard>, pick the Bito Chess project.
2. Left menu → **SQL Editor** → **New query**.
3. Paste everything in the block below, press **Run**. It should say "Success".
4. That's it. Sign in on the phone; the first sign-in seeds the copy, and after
   that every edit syncs about half a minute later.

```sql
-- One row per user. The row's id IS the auth user's id, so a user can only
-- ever have one, and it disappears with the account.
--
-- `repertoire` holds the lines AND the stats/streaks/settings snapshot; the
-- imported games live in `games`, separately, because they're the heavy part and
-- they change far less often. See the note above.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  repertoire jsonb,
  repertoire_updated_at timestamptz,
  games jsonb,
  games_updated_at timestamptz,
  entitled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Safe to re-run on a project made before `entitled` existed.
alter table public.profiles
  add column if not exists entitled boolean not null default false;

-- THE MIGRATION, for a project created before games moved to their own column.
-- Adding them empty is all that's needed: any row still carrying its games
-- inside `repertoire` keeps working (the app reads them from there when `games`
-- is empty) and moves them across on its next push. Nothing to copy by hand,
-- nothing to lose.
alter table public.profiles
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

-- The policy above is row-scoped, not column-scoped: without the next lines it
-- would let any signed-in user flip their own `entitled` to true from the
-- browser. Column privileges are the fix — take UPDATE away wholesale, then hand
-- it back only on the four columns the sync actually writes. Reading `entitled`
-- is untouched (that's SELECT), and so is the app's upsert.
revoke update on public.profiles from anon, authenticated;
grant update (repertoire, repertoire_updated_at, games, games_updated_at)
  on public.profiles to authenticated;
grant insert (id, repertoire, repertoire_updated_at, games, games_updated_at)
  on public.profiles to authenticated;
```

**Already ran an earlier version of this block?** Paste it again as-is. Every
statement is either `if not exists`, a drop-then-create, or a grant that restates
itself, so a re-run adds the two `games` columns and leaves everything else
exactly as it was. Your existing synced data is untouched.

## Turning on full access for an account

Table Editor → `profiles` → find the row by `id` → tick `entitled` → save. The
app picks it up on the next launch or sign-in (it re-reads the flag once per
sign-in, then caches it for offline use).

No delete policy on purpose: the app never deletes a row, and neither should a
stray request. Removing the account removes the row (`on delete cascade`).

## How the sync behaves

- **Reads always come from the phone.** IndexedDB stays the source of truth;
  Supabase holds a copy, never the working data.
- **First sign-in on a device** looks before it writes. If the account already
  holds a copy, the app asks the same thing a manual "Import backup" asks —
  *merge* (nothing is deleted) or *replace everything*. If the account is empty,
  the phone's data is pushed up to seed it.
- **After that**, a change pushes about 30 seconds later — the same cadence as the
  Google Drive backup, so an editing burst is one upload. Only the half that
  changed goes: edit a line and the games stay put; import games and the lines
  stay put. A half whose contents are byte-for-byte what was last pushed isn't
  sent at all.
- **Closing the app** inside that 30-second window pushes on the way out rather
  than waiting for the next launch. Best-effort — Android can kill a PWA before
  the request lands — so the next launch retries anything still owed, which costs
  nothing when it turns out the push did get through.
- **Offline is fine.** The change is already saved on the phone; the Account
  section shows "Pending" or "Sync failed — will retry", and the next edit or
  app launch tries again.
- **Signing out** leaves the account's copy alone and puts this device back to
  "not synced here". Signing back in asks the merge-or-replace question again.
- **Erasing everything** can't reach the account's copy. The erase deliberately
  doesn't announce itself to the sync, and it also clears the signed-in session,
  so there's nothing to push and no way to push it. Sign back in afterwards and
  the copy is offered back to you.

## Worth knowing

**It's last-write-wins, not real sync.** Each half goes up as one value, so
editing on two devices inside the same window means one quietly overwrites the
other. There's no per-line merge and no way to tell "deleted" from "hasn't
arrived yet". The Drive backup has the same ceiling. Fixing it properly needs
per-line timestamps and deletion tombstones, which are parked in PUBLISHING.md.
With one person and one phone you'll never meet it, and the merge-or-replace
question on a new device covers the case that actually bites.

**How big does this get?** Measured on a synthetic heavy user: a bare imported
game is ~1.3 KB, one carrying a saved analysis is ~18 KB, and the app-state
snapshot is ~127 KB. So the lines-and-settings half is 0.2–1.3 MB, and a
thousand games with a scattering of analyses is 3–5 MB, rising towards 20 MB if
you saved an analysis on every single one. Storage isn't the concern (one row per
user, and Postgres compresses jsonb); the concern was re-uploading megabytes of
unchanged games over mobile data, which is what the split fixed.

**One thing still unmeasured:** Supabase publishes no request-body limit for the
REST API, and the real limit comes from the gateway in front of it. If a very
heavy games library ever fails to sync while the lines keep syncing fine, that's
the suspect. `npm run probe-sync-limit <url> <anon-key>` answers it in a minute —
it sends increasingly large bodies and reports where they start bouncing. It
writes nothing (every request is rejected by row-level security by design), and
the anon key it needs is the public one already in the app bundle.
