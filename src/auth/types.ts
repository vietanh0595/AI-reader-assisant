export type PersistedAuthSession = {
  accessToken: string;
  expiresIn?: number;
  idToken?: string;
  issuedAt: number;
  refreshToken?: string;
  scope?: string;
  state?: string;
  tokenType?: 'bearer' | 'mac';
};

export type AuthContextValue = {
  accessToken: string | null;
  dismissSessionExpiredNotice(): void;
  error: string | null;
  getAccessToken(forceRefresh?: boolean): Promise<string | null>;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionExpired: boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};
