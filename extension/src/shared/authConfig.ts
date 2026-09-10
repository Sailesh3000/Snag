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
  apiBaseUrl: "https://REPLACE_WITH_CDK_API_URL",
  cognitoDomain: "https://REPLACE_WITH_COGNITO_DOMAIN",
  clientId: "REPLACE_WITH_COGNITO_CLIENT_ID",
};

/** Scopes requested at authorize time; the API only needs `sub`, but the
 *  extension displays email, so it must be in the token. */
export const OAUTH_SCOPES = "openid email profile";

/** Local page the Cognito redirect lands on. */
export const CALLBACK_PATH = "oauth-callback.html";

/**
 * The redirect URI Cognito sends the browser back to.
 *
 * Chrome pre-registers the `chromiumapp.org` origin for a packed
 * extension's ID, so `chrome.runtime.getURL` already returns the
 * `https://<id>.chromiumapp.org/...` URL when the extension is packed.
 * Unpacked dev builds get a `chrome-extension://` URL, which a web page
 * can't redirect to — Chrome's documented dev-mode origin is
 * devtools-window.chromiumapp.org instead.
 *
 * BOTH values must be registered as callback URLs on the Cognito client
 * (the infra stack's ExtensionCallbackUrl parameter covers one of them).
 */
export function getRedirectUri(): string {
  const url = chrome.runtime.getURL(CALLBACK_PATH);
  if (url.startsWith("https://")) return url;
  return `https://devtools-window.chromiumapp.org/${CALLBACK_PATH}`;
}
