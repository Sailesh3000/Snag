// Paddle checkout / customer-portal URLs (plan B4).
//
// Both are placeholders until the Paddle vendor account is set up at deploy
// time (Phase 4/5). When filling them in:
//   - PADDLE_CHECKOUT_URL points at the single $10/month subscription item
//     (vendor.paddle.com/checkout?items=<itemId> or the product-based URL).
//   - PADDLE_PORTAL_URL is the customer center ("Manage subscription" link).
//
// The checkout URL gets `custom_data[cognitoSub]=<sub>` appended at runtime
// (buildCheckoutUrl) so the Paddle webhook can link the subscription to the
// Cognito user without a second lookup.

export const PADDLE_CHECKOUT_URL = "https://REPLACE_WITH_PADDLE_CHECKOUT_URL";
export const PADDLE_PORTAL_URL = "https://REPLACE_WITH_PADDLE_CUSTOMER_PORTAL_URL";

export function buildCheckoutUrl(cognitoSub: string): string {
  const sep = PADDLE_CHECKOUT_URL.includes("?") ? "&" : "?";
  return `${PADDLE_CHECKOUT_URL}${sep}custom_data[cognitoSub]=${encodeURIComponent(cognitoSub)}`;
}
