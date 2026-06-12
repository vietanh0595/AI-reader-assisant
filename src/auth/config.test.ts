import { getOidcClientConfig } from './config';

const ENV_KEYS = [
  'EXPO_PUBLIC_OIDC_ISSUER_URL',
  'EXPO_PUBLIC_OIDC_CLIENT_ID',
  'EXPO_PUBLIC_OIDC_AUDIENCE',
] as const;

describe('getOidcClientConfig', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  test('returns a complete OIDC client configuration', () => {
    process.env.EXPO_PUBLIC_OIDC_ISSUER_URL = 'https://issuer.example.com';
    process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'mobile-client';
    process.env.EXPO_PUBLIC_OIDC_AUDIENCE = 'https://api.example.com';

    expect(getOidcClientConfig()).toEqual({
      audience: 'https://api.example.com',
      clientId: 'mobile-client',
      issuerUrl: 'https://issuer.example.com',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
    });
  });

  test('returns null when all OIDC variables are absent', () => {
    expect(getOidcClientConfig()).toBeNull();
  });

  test('throws when OIDC configuration is partial', () => {
    process.env.EXPO_PUBLIC_OIDC_ISSUER_URL = 'https://issuer.example.com';
    process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'mobile-client';

    expect(() => getOidcClientConfig()).toThrow(
      'OIDC client configuration is incomplete.',
    );
  });

  test('trims configured values and treats whitespace-only values as absent', () => {
    process.env.EXPO_PUBLIC_OIDC_ISSUER_URL = '  https://issuer.example.com  ';
    process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = '  mobile-client  ';
    process.env.EXPO_PUBLIC_OIDC_AUDIENCE = '  https://api.example.com  ';

    expect(getOidcClientConfig()).toMatchObject({
      audience: 'https://api.example.com',
      clientId: 'mobile-client',
      issuerUrl: 'https://issuer.example.com',
    });

    for (const key of ENV_KEYS) {
      process.env[key] = '   ';
    }
    expect(getOidcClientConfig()).toBeNull();
  });
});
