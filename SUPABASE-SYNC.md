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

| column                  | type          | what it holds                                    |
| ----------------------- | ------------- | ------------------------------------------------ |
| `id`                    | `uuid`        | the user's auth id (the row's key)               |
| `repertoire`            | `jsonb`       | the whole backup blob — same JSON as an export    |
| `repertoire_updated_at` | `timestamptz` | when that blob was last pushed                    |
| `entitled`              | `boolean`     | has this account paid? Gates the training cap     |

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
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  repertoire jsonb,
  repertoire_updated_at timestamptz,
  entitled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Safe to re-run on a project made before `entitled` existed.
alter table public.profiles
  add column if not exists entitled boolean not null default false;

-- Row-level security: without this, the public anon key in the app bundle
-- would let anyone read everyone's rows. With it, every query is silently
-- filtered to the signed-in user's own row — which is what makes shipping
-- that key in the JavaScript safe.
alter table public.profiles enable row level security;

create policy "own profile: read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "own profile: insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "own profile: update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- The policy above is row-scoped, not column-scoped: without the next three
-- lines it would let any signed-in user flip their own `entitled` to true from
-- the browser. Column privileges are the fix — take UPDATE away wholesale, then
-- hand it back only on the two columns the sync actually writes. Reading
-- `entitled` is untouched (that's SELECT), and so is the app's upsert.
revoke update on public.profiles from anon, authenticated;
grant update (repertoire, repertoire_updated_at) on public.profiles to authenticated;
grant insert (id, repertoire, repertoire_updated_at) on public.profiles to authenticated;
```

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
- **After that**, any change to the repertoire pushes the whole blob about 30
  seconds later — the same cadence as the Google Drive backup, so an editing
  burst is one upload.
- **Offline is fine.** The change is already saved on the phone; the Account
  section shows "Pending" or "Sync failed — will retry", and the next edit or
  app launch tries again.
- **Signing out** leaves the account's copy alone and puts this device back to
  "not synced here". Signing back in asks the merge-or-replace question again.

## Worth knowing

The blob is the full backup file — lines, imported games and the app-state
snapshot — because that's what makes a new phone land exactly where the old one
was. Imported games are by far the bulkiest part of it, so a heavy Chess.com
import makes every sync bigger. If that ever becomes a problem (a slow sync on
mobile data, or the project's storage filling up), the fix is to leave games out
of the synced copy and keep them in the Drive backup only — a small change, made
when there's evidence it's needed rather than up front.
