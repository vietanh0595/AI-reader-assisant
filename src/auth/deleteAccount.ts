import { describeRequestFailure } from '../api/describeRequestFailure';
import { fetchWithRetry } from '../api/fetchWithRetry';

export type DeleteAccountArgs = {
  apiBaseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  signOut: () => void | Promise<void>;
};

/**
 * Delete the signed-in account on the server, then sign out.
 *
 * The order is the whole point. The access token stays valid after the account is
 * deleted, and the server provisions a user from the token whenever one is missing,
 * so any authenticated request made afterwards silently recreates the account that
 * was just deleted. Signing out immediately — with nothing in between — is what makes
 * the deletion stick.
 *
 * The reverse order is just as deliberate: a delete the server rejected must leave the
 * reader signed in. Signing them out of an account that still exists would tell them it
 * was deleted and leave them no obvious way to try again.
 */
export async function deleteAccount({
  apiBaseUrl,
  accessToken,
  fetchImpl,
  signOut,
}: DeleteAccountArgs): Promise<void> {
  let response: Response;

  try {
    response = await fetchWithRetry(
      `${apiBaseUrl}/auth/me`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      fetchImpl ? { fetchImpl } : undefined,
    );
  } catch (error) {
    throw new Error(describeRequestFailure(error));
  }

  if (!response.ok) {
    throw new Error(`Deleting your account failed (${response.status}). Please try again.`);
  }

  await signOut();
}
