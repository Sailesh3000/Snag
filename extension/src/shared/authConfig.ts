/**
 * Build-time constants for the Snag backend and Cognito user pool.
 *
 * These are placeholders. The release pipeline (Phase 4) overlays a
 * per-environment value — the real ones are CDK stack outputs (ApiUrl,
 * the user pool domain derived from UserPoolId, UserPoolClientId). Real
 * values must never be committed to the repo.
 */
export interface AuthConfig {
  /** Base URL of the JWT-gated HTTP API, no trailing slash. */
  apiBaseUrl: string;
  /** Cognito user pool domain, e.g. https://xxx.auth.us-east-1.amazoncognito.com */
  cognitoDomain: string;
  /** Public OAuth client ID (no secret — PKCE). */
  clientId: string;
}

export const authConfig: AuthConfig = {
  apiBaseUrl: "https://dt2ax5v2q0.execute-api.ap-south-1.amazonaws.com",
  cognitoDomain: "https://snag-615105803998.auth.ap-south-1.amazoncognito.com",
  clientId: "2cti7frj2pooci6rt181rt83fp",
};

/** Scopes requested at authorize time; the API only needs `sub`, but the
 *  extension displays email, so it must be in the token. */
export const OAUTH_SCOPES = "openid email profile";

/** Path segment of the Cognito redirect. No extension — must exactly
 *  match the callback URL registered on the Cognito app client. */
export const CALLBACK_PATH = "oauth-callback";

/**
 * The redirect URI Cognito sends the browser back to.
 *
 * `chrome.identity.getRedirectURL(path)` is the documented, purpose-built
 * API for this: it always returns `https://<extension-id>.chromiumapp.org/
 * <path>`, using the extension's actual ID — Chrome only intercepts
 * navigation to that exact pattern within launchWebAuthFlow's window, so
 * anything else (including a hand-built URL that doesn't match the real
 * ID) fails with "Authorization page could not be loaded" instead of
 * completing the flow.
 *
 * `manifest.json` pins a `"key"` field, so the extension ID is the SAME
 * deterministic value (`jobacpbllhlmlidhnhoaobcdidjfknif`) whether loaded
 * unpacked (dev) or from the Chrome Web Store — one callback URL covers
 * both, no dev/prod split needed.
 */
export function getRedirectUri(): string {
  return chrome.identity.getRedirectURL(CALLBACK_PATH);
}
