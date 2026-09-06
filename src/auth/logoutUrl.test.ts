import { buildLogoutUrl } from './logoutUrl';

const base = {
  endSessionEndpoint: 'https://tenant.eu.auth0.com/oidc/logout',
  clientId: 'client-123',
  postLogoutRedirectUri: 'aibookreader://callback',
};

function paramsOf(url: string) {
  return new URL(url).searchParams;
}

test('returns nothing when the provider has no logout endpoint', () => {
  // Sign-out must still clear the local session; it just cannot clear the
  // provider's cookie, so there is no URL to open.
  expect(buildLogoutUrl({ ...base, endSessionEndpoint: undefined })).toBeNull();
});

test('points at the provider logout endpoint', () => {
  const url = buildLogoutUrl(base)!;

  expect(url.startsWith('https://tenant.eu.auth0.com/oidc/logout?')).toBe(true);
});

test('identifies the app so the provider knows whose session to end', () => {
  expect(paramsOf(buildLogoutUrl(base)!).get('client_id')).toBe('client-123');
});

test('tells the provider where to send the browser back to', () => {
  expect(paramsOf(buildLogoutUrl(base)!).get('post_logout_redirect_uri')).toBe(
    'aibookreader://callback',
  );
});

test('passes the id token so the provider can end the right session', () => {
  expect(paramsOf(buildLogoutUrl({ ...base, idToken: 'id-token-abc' })!).get('id_token_hint')).toBe(
    'id-token-abc',
  );
});

test('omits the id token hint when there is no id token to give', () => {
  // A session restored from storage may have no id_token. Sending an empty hint
  // makes Auth0 reject the request outright, which would leave the cookie alive.
  expect(paramsOf(buildLogoutUrl(base)!).has('id_token_hint')).toBe(false);
  expect(paramsOf(buildLogoutUrl({ ...base, idToken: '' })!).has('id_token_hint')).toBe(false);
});
