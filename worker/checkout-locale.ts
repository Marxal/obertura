// Which language Stripe Checkout speaks, from the language the buyer is using in Bito.
// Stripe has Spanish and Swedish but no Catalan, so Catalan gets Spanish. Anything else
// is 'auto', what Stripe does anyway when it's told nothing: it follows the browser.

export type CheckoutLocale = 'es' | 'sv' | 'auto';

export function checkoutLocale(language: unknown): CheckoutLocale {
  if (typeof language !== 'string') return 'auto';
  const code = language.toLowerCase().split('-')[0];
  if (code === 'ca' || code === 'es') return 'es';
  if (code === 'sv') return 'sv';
  return 'auto';
}
