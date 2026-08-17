// POST /api/stripe/checkout — turn "I want to buy this" into a Stripe URL.
//
// Body:    { "price_id": "price_…" }
// Header:  Authorization: Bearer <the caller's Supabase access token>
// Answer:  { "url": "https://checkout.stripe.com/c/pay/…" }
//
// The app then navigates there. That's the whole endpoint.
//
// ── THE ID COMES FROM THE TOKEN, NEVER FROM THE BODY ────────────────────────
// This is the one thing in this file that must not be softened. The session
// carries a `user_id` in its metadata, and the webhook flips `entitled` on
// whatever row that names — so whoever controls that value controls who gets
// full access. It is read out of a Supabase-validated JWT (verifyUser in
// stripe-env.ts) and nowhere else. A `user_id` field in the request body would
// be a stranger's account, one curl away.
//
// The token also carries the email, which is why the checkout can pre-fill it
// without the app sending anything: `customer_email` below comes from the same
// verified source as the id.
//
// ── WHY THE PRICE IS CHECKED TOO ────────────────────────────────────────────
// A price id is not a secret and the app sends the one it was quoted, so the
// obvious thing is to pass it straight to Stripe. But it arrives from a browser,
// and a browser can send any of the account's price ids — including the archived
// 1€ one from a launch experiment, or a €0 comp. So it is retrieved and must
// come back active, one-time, and (when STRIPE_PRODUCT_ID is set) attached to
// the right product. That is one extra round trip on a click that is about to
// take twenty seconds anyway.
//
// ── WHY THE RETURN URLS ARE DERIVED, NOT CONFIGURED ─────────────────────────
// success_url and cancel_url are built from the request's own origin, so the
// same code sends a bitochess.com visitor back to bitochess.com and a
// preview-deployment visitor back to the preview. A hard-coded domain here is a
// test purchase that lands on production, or a production purchase that lands on
// a URL nobody is watching.
//
// `?purchased=1` is the signal src/checkout.ts reads at boot to start polling
// for the unlock. It is the redirect path's own way of saying "a payment just
// happened"; the focus watcher behind it covers the case where this URL is never
// reached at all.

import {
  type StripeEnv,
  PRICE_ID_RE,
  json,
  problem,
  stripeClient,
  supabasePublicConfig,
  verifyUser,
} from './stripe-env';

// Where Stripe sends people afterwards, appended to the origin the request came
// from. The trainer lives under /app/ on bitochess.com (DEPLOY_TARGET=cloudflare
// in vite.config.ts), which is the only host that has this Worker in front of it.
const SUCCESS_PATH = '/app/?purchased=1';
const CANCEL_PATH = '/app/';

export async function handleStripeCheckout(request: Request, env: StripeEnv): Promise<Response> {
  if (request.method !== 'POST') return problem(405, 'method not allowed');

  const secretKey = env.STRIPE_SECRET_KEY;
  const supabase = supabasePublicConfig(env);
  if (!secretKey || !supabase) {
    // A deployment mistake, not a bad request. 500 so it reads as one in the
    // logs, and so the app's "couldn't start checkout" message is honest.
    console.error('stripe checkout: missing configuration');
    return problem(500, 'not configured');
  }

  // Who is asking. Everything after this line is about a verified account.
  const user = await verifyUser(request, supabase);
  if (!user) return problem(401, 'sign in first');

  let body: { price_id?: unknown };
  try {
    body = (await request.json()) as { price_id?: unknown };
  } catch {
    return problem(400, 'bad request');
  }

  const priceId = typeof body?.price_id === 'string' ? body.price_id.trim() : '';
  if (!PRICE_ID_RE.test(priceId)) return problem(400, 'bad price');

  try {
    const stripe = stripeClient(secretKey);

    // ── Is this actually something we sell? ───────────────────────────────────
    const price = await stripe.prices.retrieve(priceId);
    const productId = typeof price.product === 'string' ? price.product : price.product?.id;
    const sellable =
      price.active
      && price.type === 'one_time'
      && !price.recurring
      && typeof price.unit_amount === 'number'
      && (!env.STRIPE_PRODUCT_ID || productId === env.STRIPE_PRODUCT_ID);

    if (!sellable) {
      console.error(`stripe checkout: refused price ${priceId} (not a sellable one-time price)`);
      return problem(400, 'bad price');
    }

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      // One payment, forever. Not a subscription — see the note in
      // stripe-prices.ts about why that is filtered rather than merely unused.
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],

      // Pre-filled from the verified token, so nobody retypes an address the
      // account already knows. Stripe shows it locked to that address, which
      // also means a receipt cannot go to the wrong inbox by typo.
      ...(user.email ? { customer_email: user.email } : {}),

      // Make a Customer object even for a one-off payment. Stripe's default for
      // `mode: 'payment'` is not to, and without one there is no
      // `stripe_customer_id` for the webhook to store and nothing to look up in
      // the dashboard six months later when somebody asks about their receipt.
      customer_creation: 'always',

      // 'auto' asks for as little as the payment method demands and nothing
      // more — usually just a country and postal code, often nothing at all for
      // a wallet. A full billing address is a form nobody enjoys and a
      // conversion drop for a €9 sale.
      //
      // NOTE, because it is a real obligation and not a code concern: going
      // direct on Stripe makes you the merchant of record, so evidence of the
      // customer's country is yours to keep for EU VAT. Stripe Tax
      // (`automatic_tax: { enabled: true }`) is what automates that, at 0.5% a
      // transaction, and is deliberately OFF here. Prices are treated as
      // tax-inclusive. See STRIPE-SETUP.md.
      billing_address_collection: 'auto',

      // Both carry the account id, and both are on purpose.
      //   metadata      → the session, read by checkout.session.completed
      //   client_reference_id → visible in the dashboard, so a human looking at
      //                         a payment can see which account it belongs to
      //                         without opening the metadata drawer
      metadata: { user_id: user.id },
      client_reference_id: user.id,

      // The payment intent gets its own copy, which the resulting charge
      // inherits. That is what makes a refund traceable back to an account:
      // `charge.refunded` carries no session, so without this the webhook would
      // have nothing to match a refund against. See stripe-webhook.ts.
      payment_intent_data: { metadata: { user_id: user.id } },

      success_url: `${origin}${SUCCESS_PATH}`,
      cancel_url: `${origin}${CANCEL_PATH}`,
    });

    if (!session.url) {
      // Documented as nullable, and in practice only for session modes this
      // isn't. Loud rather than handing the app an undefined to navigate to.
      console.error(`stripe checkout: session ${session.id} came back with no url`);
      return problem(502, 'no checkout url');
    }

    console.log(`stripe checkout: session ${session.id} for ${user.id} (${priceId})`);
    return json({ url: session.url });
  } catch (err) {
    // Card-network trouble cannot happen yet — nothing has been paid at this
    // point. This is Stripe being unreachable, a rejected key, or a price that
    // vanished between the quote and the click.
    console.error(`stripe checkout: session creation failed (${describe(err)})`);
    return problem(502, 'checkout unavailable');
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'unknown error';
}
