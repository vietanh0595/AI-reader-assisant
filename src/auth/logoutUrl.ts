export type LogoutUrlParams = {
  clientId: string;
  endSessionEndpoint?: string;
  idToken?: string;
  postLogoutRedirectUri: string;
};

/**
 * The provider's RP-initiated logout URL, or null if it doesn't offer one.
 *
 * Clearing the tokens on the phone signs the app out but leaves the identity
 * provider's own session cookie alive, so the next sign-in skips the login screen
 * and offers to continue as the previous account — showing their email to whoever
 * is now holding the phone. Opening this URL ends that session too.
 *
 * Null is a normal outcome, not a failure: a provider without an end-session
 * endpoint simply cannot be signed out remotely, and the local sign-out still stands.
 */
export function buildLogoutUrl({
  clientId,
  endSessionEndpoint,
  idToken,
  postLogoutRedirectUri,
}: LogoutUrlParams): string | null {
  if (!endSessionEndpoint) {
    return null;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });

  // Only send the hint when there is a real token behind it. An empty id_token_hint
  // is rejected outright, which would leave the session cookie alive — the exact
  // thing this is here to clear.
  if (idToken) {
    params.set('id_token_hint', idToken);
  }

  return `${endSessionEndpoint}?${params.toString()}`;
}
