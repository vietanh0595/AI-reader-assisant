export type OidcClientConfig = {
  audience: string;
  clientId: string;
  issuerUrl: string;
  scopes: string[];
};

const OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export function getOidcClientConfig(): OidcClientConfig | null {
  const issuerUrl = process.env.EXPO_PUBLIC_OIDC_ISSUER_URL?.trim() ?? '';
  const clientId = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID?.trim() ?? '';
  const audience = process.env.EXPO_PUBLIC_OIDC_AUDIENCE?.trim() ?? '';
  const configuredValues = [issuerUrl, clientId, audience];

  if (configuredValues.every((value) => value.length === 0)) {
    return null;
  }

  if (configuredValues.some((value) => value.length === 0)) {
    throw new Error('OIDC client configuration is incomplete.');
  }

  return {
    audience,
    clientId,
    issuerUrl,
    scopes: [...OIDC_SCOPES],
  };
}
