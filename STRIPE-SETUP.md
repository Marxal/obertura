# The buy flow — Stripe setup (no code)

Someone pays, and their account gets full access without you touching the
Supabase dashboard. **The code is written and merged, and the app half is wired
— the buttons work.** What's left is what always has to happen by hand: the
dashboards, the secrets, and — easy to miss, so it gets its own step —
**actually deploying the Worker.**

Nothing here is testable from the phone until Step 4 is done. The only real
test after that is a purchase (Stripe test mode makes that free — see the end).

Work through it in order. Steps 1–6 all have to be done before the first real
payment; step 7 is the tidy-up of the old processor.

> **If you've done the dashboard steps and the app still shows the old €9
> fallback price, or "Couldn't reach the checkout" — you're almost certainly
> missing Step 4.** Pushing code to GitHub does not deploy a Cloudflare
> Worker. Nothing in this repo does that automatically; it's a command you run
> by hand, every time the Worker's code changes.

## What changed, and what it means for you

Lemon Squeezy was the **merchant of record**: legally they were the seller, and
they handled VAT for every country a buyer lived in. Going direct on Stripe makes
**you** the seller — Marçal Morell Torra, sole trader in Sweden.

That is the whole point of the move (a better rate, your own brand on the
checkout, your own customer list), and it comes with one obligation the old setup
absorbed for you:

> **EU VAT on digital sales to consumers is now yours to handle.** Selling a
> digital service to a consumer in another EU country means VAT at *their*
> country's rate, declared through the **OSS** scheme (Skatteverket registers you
> for it — "One Stop Shop", one quarterly return covering all of the EU). Below
> the Swedish VAT-registration threshold, or selling only to Swedish customers,
> the picture is simpler. **Ask an accountant about your specific situation
> before the first live sale.** This is the one part of the migration that
> software cannot do for you.

Two things the code does about it:

- Prices are **VAT-inclusive**. What the price card says is what the customer
  pays; nothing is added at the end. `docs/terms.html` now says so.
- **Stripe Tax is deliberately OFF.** It is what automates the rate-per-country
  calculation, and it costs 0.5% per transaction. Turning it on is one line in
  `worker/stripe-checkout.ts` (`automatic_tax: { enabled: true }`) plus the
  Stripe dashboard's Tax section. Flagged rather than assumed, per the
  no-paid-services rule.

Stripe also records the customer's country from the payment method, which is the
evidence a VAT return needs. `billing_address_collection: 'auto'` asks for the
minimum on top of that — usually nothing at all for a wallet payment.

## The moving parts

```
  phone: "Unlock full access"        landing page: "Unlock full access"
        │                                   │
        │  no account? sign-up sheet,       │  no account? → /app/?auth=signup&buy=1
        │  then straight on                 │  (the app finishes the job)
        ▼                                   ▼
  POST /api/stripe/checkout   ← carries the Supabase ACCESS TOKEN, not a user id
        │                       the Worker verifies it and takes the account id
        │                       and email out of the token itself
        ▼
  Stripe Checkout (checkout.stripe.com)   card · Apple Pay · Google Pay
        │  payment succeeds
        ├─────────────────────────────► browser returns to /app/?purchased=1
        │                                    │  the app starts polling
        ▼                                    │
  Stripe sends a signed webhook              │
        │                                    │
        ▼                                    │
  bitochess.com/api/stripe/webhook  ← worker/index.ts
        │  checks the signature, reads metadata.user_id
        ▼                                    │
  Supabase: profiles.entitled = true, entitled_at = now
        │                                    │
        ▼                                    ▼
  the app polls profiles.entitled for ~20s after a checkout → cap lifted
```

The last step is a POLL, not a single read, because the webhook usually lands a
second or two after the payment does. Four separate things can start it
(`src/checkout.ts` explains why four): `?purchased=1` on the return URL, the app
regaining focus, a checkout started in this session, and the **"Already paid?
Check again"** link in Settings. That last one is the manual backstop for the day
the other three all miss.

The webhook is the only part that can grant access. The browser cannot: the SQL
in SUPABASE-SYNC.md revokes the right to write `entitled` from every key the app
ships with, so a user editing their own requests gets nowhere.

## Step 1 — the database columns

Run the block in SUPABASE-SYNC.md again (it is safe to re-run). It adds
`stripe_customer_id` and `stripe_payment_intent_id`, which the webhook stamps
alongside `entitled`. Nothing reads them; they are there so a row can answer
"which Stripe payment was this?" without searching the dashboard by email.

## Step 2 — the product and its two prices

Stripe dashboard → **Product catalogue** → **+ Add product**

- **Name**: `Bito Chess — Full Access`. This is what appears on the checkout page
  and on the receipt, so write it the way a customer should read it.
- **Description**: `Unlimited training rotation. One-time payment.`
- **Pricing model**: **One-off** — *not* recurring. Bito Chess sells a single
  payment and says so in the app, on the landing page and in the terms. The code
  filters recurring prices out on purpose, so a subscription price created here
  would simply never appear.
- **Price**: `9.00` **EUR**.

Save it, then add the second currency **as a second, fully separate price** — not
via "Add a price by currency" on the price you just made. That option bundles the
new currency as an alternate *inside the same Price object*, invisible to this
code, which reads each currency from its own independent Price. The giveaway if
you land there by mistake: the product's Pricing table shows only one row, marked
"Default".

The right button is on the **product page itself**, not the price's edit screen:
the **`+`** next to the **Pricing** section header → **+ Add price**. That opens a
blank price form, entirely separate from the one you just made:

- **Pricing model**: **One-off**.
- **Price**: `99.00` **SEK**.

**Set the SEK amount by hand, as a round 99 kr — do not let Stripe convert.** A
Swede should see a number that looks deliberate in Swedish, not `103,47 kr`
picked by yesterday's exchange rate. `docs/terms.html` already quotes
"€9 / 99 SEK".

When you're done, the product's **Pricing** table should show **two rows** — one
EUR, one SEK, each with its own price id. One row means the second currency ended
up attached to the first price instead of standing on its own; go back and use
**+ Add price** rather than the currency option on the existing one.

Then copy two things down:

| what | where it is | what it's for |
| ---- | ----------- | ------------- |
| the **product** id (`prod_…`) | the product page URL, or its API section | step 3's `STRIPE_PRODUCT_ID` |
| the two **price** ids (`price_…`) | each price's row | nothing to paste — the app fetches them. Handy for debugging. |

You do **not** paste price ids anywhere. `GET /api/stripe/prices` lists them, and
both the app and the landing page read the price card off that list. That is the
point of the endpoint: the number a visitor reads is the number Stripe charges.

### Wallets

Apple Pay and Google Pay need **no** setup here beyond having card payments
enabled (Settings → **Payment methods**). The checkout is hosted on Stripe's own
domain, so there is no domain to verify — that requirement only applies to the
embedded checkout, which this project deliberately doesn't use (see the note at
the top of `src/checkout.ts`).

## Step 3 — the Cloudflare secrets

The Worker reads these at runtime. They are **Worker secrets, not `VITE_`
variables** — anything prefixed `VITE_` is baked into the JavaScript the browser
downloads, and two of these would be catastrophic there.

Either paste them in the dashboard (Workers & Pages → **bitochess** → Settings →
Variables and Secrets → **Add** → type *Secret*), or from a terminal:

```
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRODUCT_ID
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
```

| name | where it comes from | required? |
| ---- | ------------------- | --------- |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → **Secret key** (`sk_live_…`, or `sk_test_…` while testing) | **yes** |
| `STRIPE_WEBHOOK_SECRET` | Stripe gives it to you in step 5 (`whsec_…`) | **yes** |
| `STRIPE_PRODUCT_ID` | step 2 (`prod_…`) | strongly recommended — see below |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role**, the secret one | **yes** |
| `SUPABASE_URL` | the same project URL already set as `VITE_SUPABASE_URL` | falls back to the `VITE_` one |
| `SUPABASE_ANON_KEY` | the same public key already set as `VITE_SUPABASE_ANON_KEY` | falls back to the `VITE_` one |

**`STRIPE_PRODUCT_ID` is what stops the wrong price being sold.** Without it, any
active one-time price in the whole Stripe account is sellable by anyone who can
name it — including an archived launch-discount price, or a €0 comp you made for
a friend. With it, `/api/stripe/prices` lists only this product's prices and
`/api/stripe/checkout` refuses anything else. It is not secret; it is a secret
here only because that is the same box every other Worker variable goes in.

**The two Supabase names have a fallback, and you probably want to know why.**
The Cloudflare project already sets `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` for the browser build, and they are the same strings. A
Worker can read any plain variable whatever its name, so the endpoints read the
unprefixed name **or** the `VITE_` one, in that order. Without that fallback a
project with only the `VITE_` ones answers `500 not configured` on every request
while the dashboard looks perfectly set up. Setting the unprefixed names as well
is tidier; nothing breaks either way.

The service_role key ignores every row-level security rule in the project, and
the Stripe secret key can move money. Both belong in exactly two places: the
dashboard each came from, and this secret store. Never in `.env`, never in the
repo, never in a `VITE_` variable.

Until the required ones are set the webhook answers `500 not configured`, which
Stripe retries for up to three days — so deliveries that arrive before you finish
here are not lost.

## Step 4 — deploy the Worker

**This is the step it's easiest to skip, because nothing prompts for it.**
Merging this branch, or pulling it to your machine, does not put the new code
anywhere Stripe or the app can reach. A Cloudflare Worker is deployed by
running a command — there is no git integration doing it in the background for
this project (check `wrangler.jsonc` if you want to see why: it deploys via
`npx wrangler deploy`, not a connected build).

From a checkout of the branch with this Stripe code (main, once merged):

```
DEPLOY_TARGET=cloudflare npm run build
npx wrangler deploy
```

The first command builds the site into `dist/` with the trainer under `/app/`
and the landing page at the root — the shape `wrangler.jsonc`'s `assets`
binding expects. The second uploads `dist/` **and** the Worker code
(`worker/*.ts`) together; `wrangler deploy` doesn't build anything itself, it
just ships whatever's already in `dist/`, so the order matters.

**Do this again every time `worker/*.ts` or anything under `src/` changes.**
There's no CI step in this repo that does it for you.

### Checking it actually took

Open `https://bitochess.com/api/stripe/prices` directly in a browser (or
`curl` it). You should get back JSON — `{"prices":[...]}` with your real
prices, or `{"prices":[]}` if a secret is still missing. What you should
**not** see is a 404, or nothing at all: either of those means the deploy
above didn't happen or didn't include this code.

Then run `npx wrangler tail` and reload the paywall or tap "Unlock full
access". If nothing shows up in the tail output at all, the Worker being hit
isn't running this code — deploy again. If you see a line like
`stripe prices: STRIPE_SECRET_KEY is not set`, the deploy worked and Step 3
needs another look.

## Step 5 — the webhook in Stripe

Stripe dashboard → Developers → **Webhooks** → **+ Add endpoint**

- **Endpoint URL**: `https://bitochess.com/api/stripe/webhook`
- **Events to send** — tick these four:

| event | what the code does with it |
| ----- | -------------------------- |
| `checkout.session.completed` | the ordinary grant. Card or wallet, paid on the spot. |
| `checkout.session.async_payment_succeeded` | the delayed grant. Some methods complete the session first and confirm the money days later; without this, such a customer pays and is never entitled. |
| `charge.refunded` | returns the account to the free tier, which is what `docs/terms.html` promises. Full refunds only — a partial refund leaves access alone. |
| `customer.subscription.updated` / `.deleted` | *optional.* Unreachable while the product is one-off. Tick them only if you want the log line the code writes for them. |

Then **reveal the signing secret** on the endpoint's page and paste it into
`STRIPE_WEBHOOK_SECRET` (step 3). That secret is what proves a call really came
from Stripe and not from someone who guessed the URL.

**Test mode and live mode have separate webhook endpoints and separate signing
secrets.** Whichever mode's key is in `STRIPE_SECRET_KEY` is the mode you are
testing, and the `whsec_…` has to match it. Getting this pair crossed is the
single most common cause of `401 bad signature`.

## Step 6 — where the buyer lands afterwards

**Nothing to configure.** Unlike Lemon Squeezy, the return URLs are set per
session by `worker/stripe-checkout.ts`, built from the origin the request came
from:

- success → `<origin>/app/?purchased=1`
- cancel → `<origin>/app/`

`?purchased=1` is what tells the app a payment just happened, so it starts
polling for the unlock instead of waiting for the next sign-in. Deriving it from
the request means a test purchase can never land on production and vice versa.

## Step 7 — decommissioning Lemon Squeezy

Do this **after** a real Stripe purchase has worked end to end, not before. The
old webhook path (`/api/lemonsqueezy/webhook`) no longer exists in the Worker, so
any delivery Lemon Squeezy still attempts gets a `404` — which means a straggler
purchase would not be granted. That is the reason for the ordering.

1. **Lemon Squeezy → Settings → Webhooks** — delete the
   `bitochess.com/api/lemonsqueezy/webhook` endpoint. It can only fail now.
2. **Check for unprocessed deliveries first.** Same screen: any red delivery from
   the changeover window is a customer who paid and was never entitled. Tick
   `entitled` by hand for each (Supabase → Table Editor → `profiles`).
3. **The product** → deactivate or delete it, so no old link can take a payment
   into an account whose webhook is gone. Old checkout URLs are public and live
   on in browser history and bookmarks; this is what closes them.
4. **Payouts** — make sure the last balance has actually reached your bank before
   closing anything.
5. **Keep the account, and keep the records.** Lemon Squeezy holds the VAT
   records and receipts for every sale they made as merchant of record, and those
   have a retention period (seven years in Sweden). Export the order history
   before you close anything, and don't close the store until you're sure you
   have it.
6. **Cloudflare secrets** → delete `LEMONSQUEEZY_WEBHOOK_SECRET`. Nothing reads
   it any more.
7. Old customers need nothing. `profiles.entitled` is the only thing the app
   reads, it does not record which processor set it, and nothing in this
   migration touches an existing row. **Everyone who bought through Lemon
   Squeezy keeps their access, permanently.**

## Testing it

Use Stripe **test mode** (the toggle in the dashboard). Put the `sk_test_…` key
and the test-mode endpoint's `whsec_…` in the Cloudflare secrets, and pay with
Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.

Test-mode payments **do** grant access — they can only come from your own account
and they are signature-checked like any other, and being able to exercise the
whole path for free is worth more than refusing them. Remember to swap both
secrets back to live keys afterwards.

Watch it happen:

```
npx wrangler tail
```

You want to see `stripe checkout: session cs_… for <uuid>` on the tap, then
`stripe webhook: entitled <uuid> from session cs_…` a second later. In Supabase,
the row's `entitled` flips to true and `entitled_at` gets a timestamp. On the
phone you shouldn't have to do anything: within a few seconds of coming back from
the checkout the app says **"You're in"** and the Train hub's "10 lines" counter
is gone. If it doesn't, Settings → **"Already paid? Check again"** is the same
check on demand, and it always answers one way or the other.

Also worth one look each: open the paywall on a phone set to Swedish and confirm
it says **99 kr**, and open it on any other phone and confirm **9€**.

If a delivery fails, Stripe retries it with backoff for up to three days and the
webhook's page shows the status code. The webhook is deliberately noisy this way;
see the long comment at the top of `worker/stripe-webhook.ts` for why it is the
one part of this app that does not fail quietly.

| status | what happened |
| ------ | ------------- |
| `200 ok` | access granted |
| `200 revoked` | a full refund returned an account to the free tier |
| `200 pending` | a delayed payment method — the session completed, the money hasn't cleared. `async_payment_succeeded` follows. |
| `200 ignored` | a genuine event we don't act on |
| `401 bad signature` | `STRIPE_WEBHOOK_SECRET` ≠ the endpoint's secret — usually test-mode/live-mode crossed |
| `422 no user id` | a payment with no `metadata.user_id`. Shouldn't happen from either surface; tick `entitled` by hand and check what created that session. |
| `500 not configured` | one of the required secrets is missing |
| `500 write failed` | Supabase rejected the write — check the step-1 columns exist |

And for the two endpoints in front of it:

| status | what happened |
| ------ | ------------- |
| `401 sign in first` (checkout) | the access token was missing, expired or rejected. The app asks for a fresh sign-in; the landing page hands over to the app, which can refresh. |
| `400 bad price` (checkout) | the price id isn't an active one-off price of `STRIPE_PRODUCT_ID`. Check step 2 and step 3. |
| `502 checkout unavailable` | Stripe didn't answer. Nothing charged; the tap can be retried. |
| `200 {"prices":[]}` | no `STRIPE_SECRET_KEY`, or no matching prices. The paywall falls back to its built-in number and the buy button hands over to the app. |

## Where the price is written

Four copies, and only one of them charges anybody:

| where | what it is |
| ----- | ---------- |
| **Stripe** (step 2) | the real one. It takes the money. |
| `src/pricing.ts` → `FALLBACK_AMOUNTS` | the app's offline/no-network fallback |
| `docs/index.html` → `.tier__price` | the landing page's no-JS fallback, overwritten from Stripe on load |
| `docs/index.html` → the JSON-LD `offers` block, and the page's `<meta name="description">` | static, EUR, for search engines |

Change the Stripe price and the app and landing page follow on their own within
ten minutes (`PRICE_TTL_MS` in `worker/stripe-prices.ts`). The other three are
kept in step by eye — and if they ever disagree with Stripe, Stripe is right and
they are the bug.
