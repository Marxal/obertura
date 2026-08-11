# The buy flow — Lemon Squeezy setup (no code)

Someone pays, and their account gets full access without you touching the
Supabase dashboard. The code half is done and deployed. This page is the other
half: three secrets, one webhook, one checkout setting. Ten minutes.

Nothing here is testable from the phone. The only real test is a purchase.

## The moving parts

```
  phone: "Unlock full access"
        │
        ▼
  Lemon Squeezy checkout  ──(carries your Supabase user id as custom data)
        │
        │  payment succeeds
        ▼
  Lemon Squeezy sends a signed webhook
        │
        ▼
  bitochess.com/api/lemonsqueezy/webhook   ← worker/index.ts
        │  checks the signature, reads the user id
        ▼
  Supabase: profiles.entitled = true, entitled_at = now
        │
        ▼
  the app re-reads the flag → cap lifted
```

The webhook is the only part that can grant access. The browser cannot: the SQL
in SUPABASE-SYNC.md revokes the right to write `entitled` from every key the app
ships with, so a user editing their own requests gets nowhere.

## Step 1 — the database column

If your Supabase project predates this, run the block in SUPABASE-SYNC.md again
(it is safe to re-run). It adds `entitled_at`, which the webhook stamps
alongside `entitled`. Everything else is already there.

## Step 2 — the three Cloudflare secrets

The Worker reads these at runtime. They are **Worker secrets, not `VITE_`
variables** — anything prefixed `VITE_` is baked into the JavaScript the browser
downloads, and two of these would be catastrophic there.

Either paste them in the dashboard (Workers & Pages → **bitochess** → Settings →
Variables and Secrets → **Add** → type *Secret*), or from a terminal:

```
npx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_URL
```

| name                          | where it comes from                                                  |
| ----------------------------- | -------------------------------------------------------------------- |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | you invent it in step 3, when you create the webhook                  |
| `SUPABASE_SERVICE_ROLE_KEY`   | Supabase → Project Settings → API → **service_role**, the secret one   |
| `SUPABASE_URL`                | the same project URL already in `.env` as `VITE_SUPABASE_URL`          |

The service_role key ignores every row-level security rule in the project. It
belongs in exactly two places: the Supabase dashboard it came from, and this
secret. Never in `.env`, never in the repo, never in a `VITE_` variable.

Until all three are set the webhook answers `500 not configured`, which Lemon
Squeezy retries — so deliveries that arrive before you finish here are not lost.

## Step 3 — the webhook in Lemon Squeezy

Lemon Squeezy dashboard → Settings → **Webhooks** → **+**

- **Callback URL**: `https://bitochess.com/api/lemonsqueezy/webhook`
- **Signing secret**: make up a long random string. Paste the same string into
  `LEMONSQUEEZY_WEBHOOK_SECRET` above — this is what proves a call really came
  from Lemon Squeezy and not from someone who guessed the URL.
- **Events**: tick `order_created`. That is the only one the code acts on.

## Step 4 — the checkout must carry the user id

This is the step that is easy to forget and breaks everything quietly. The
webhook has no way to know *who* paid unless the checkout tells it, so the
checkout URL must carry the signed-in user's Supabase id as custom data:

```
https://<your-store>.lemonsqueezy.com/buy/<variant-id>?checkout[custom][user_id]=<supabase-user-id>
```

Lemon Squeezy passes anything under `checkout[custom][…]` straight through to
the webhook payload. The key must be exactly `user_id`.

If it is missing, the webhook answers `422 no user id` and the delivery shows up
red in the Lemon Squeezy dashboard — deliberately, so a purchase that cannot be
matched to an account is loud rather than silent. Fix it by ticking `entitled`
by hand for that person, then fixing the link.

The app builds this URL for you — `src/lemonsqueezy.ts` takes the bare buy link
from `VITE_LEMONSQUEEZY_CHECKOUT_URL` and appends the signed-in user's id. So
the only thing to do here is **set that variable** (see `.env.example`): once in
your local `.env`, and once in Cloudflare Pages → Settings → Environment
variables, because Vite bakes it in at build time. Paste the bare link — no
query string.

Unlike the three secrets above, this one IS a `VITE_` variable, and that is
correct: it is a public store page, not a key.

## Step 5 — what the buyer actually sees

The checkout opens as an **overlay on top of the app** (Lemon.js), not a
redirect, so an installed PWA never loses the user to a browser tab. The buy
button appears in two places, and only when someone is signed in and not
already entitled:

- Settings → Account, under the plan pill: "Buy full access — 99 kr"
- the upgrade dialog you hit at the training cap: "Unlock full access"

When the payment clears, Lemon.js fires a `Checkout.Success` event in the
browser. The app closes the overlay, says "Purchase received — activating your
account…", and then re-reads `profiles.entitled` a few times over ~10 seconds,
because the webhook above runs separately and usually lands a second or three
later. If it hasn't landed by then the app says access can take a minute rather
than claiming success — the webhook retries on its own, so it resolves itself.

## Testing it

Use Lemon Squeezy's test mode. Test-mode orders **do** grant access — they can
only come from your own store and they are signature-checked like any other, and
being able to exercise the whole path for free is worth more than refusing them.
The Worker logs `TEST MODE` when it sees one.

Watch it happen live:

```
npx wrangler tail
```

Then buy something. You want to see `entitled <uuid> from order <id>`. In
Supabase, the row's `entitled` flips to true and `entitled_at` gets a timestamp.
On the phone, relaunch the app — the flag is re-read once per sign-in — and the
Train hub's "10 lines" counter is gone.

If a delivery fails, Lemon Squeezy retries it and the dashboard shows the status
code. The webhook is deliberately noisy this way; see the long comment at the
top of `worker/lemonsqueezy-webhook.ts` for why it is the one part of this app
that does not fail quietly.

| status                | what happened                                          |
| --------------------- | ------------------------------------------------------ |
| `200 ok`              | access granted                                          |
| `200 ignored`         | genuine event, not a paid order (a refund, a pending order) |
| `401 bad signature`   | the secret in Cloudflare ≠ the secret in Lemon Squeezy   |
| `422 no user id`      | the checkout link is missing `checkout[custom][user_id]` |
| `500 not configured`  | one of the three secrets is missing                      |
| `500 write failed`    | Supabase rejected the write — check `entitled_at` exists  |
