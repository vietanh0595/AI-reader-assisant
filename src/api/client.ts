export type TokenGetter = (forceRefresh?: boolean) => Promise<string | null>;
export type JsonRequestInit = Omit<RequestInit, 'body'> & { body?: unknown };

function getDetailMessage(detail: unknown): string | null {
  if (typeof detail === 'string') {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (
        typeof item === 'object' &&
        item !== null &&
        'msg' in item &&
        typeof item.msg === 'string'
      ) {
        return [item.msg];
      }
      return [];
    });
    return messages.length > 0 ? messages.join('; ') : null;
  }

  if (
    typeof detail === 'object' &&
    detail !== null &&
    'message' in detail &&
    typeof detail.message === 'string'
  ) {
    return detail.message;
  }

  return null;
}

async function getResponseError(response: Response): Promise<Error> {
  const contentType = response.headers.get('Content-Type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null && 'detail' in body) {
        const message = getDetailMessage(body.detail);
        if (message) {
          return new Error(message);
        }
      }
    } catch {
      // Fall through to the status-only error.
    }
  }

  return new Error(`Request failed with status ${response.status}.`);
}

export function createApiClient(
  baseUrl: string,
  getToken: TokenGetter,
  fetchImpl: typeof fetch = fetch,
) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const token = await getToken(false);
    if (!token) {
      throw new Error('Sign in is required.');
    }

    const url = `${normalizedBaseUrl}/${path.replace(/^\/+/, '')}`;
    const performRequest = (accessToken: string) => {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      headers.set('Authorization', `Bearer ${accessToken}`);
      return fetchImpl(url, { ...init, headers });
    };

    let response = await performRequest(token);

    if (response.status === 401) {
      const refreshedToken = await getToken(true);
      if (!refreshedToken) {
        throw new Error('Sign in is required.');
      }
      response = await performRequest(refreshedToken);
    }

    if (!response.ok) {
      throw await getResponseError(response);
    }

    return response;
  };

  return {
    request,
    async json<T>(path: string, init: JsonRequestInit = {}): Promise<T | undefined> {
      const headers = new Headers(init.headers);
      let body: BodyInit | undefined;

      if (init.body !== undefined) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(init.body);
      }

      const response = await request(path, { ...init, body, headers });
      if (response.status === 204) {
        return undefined;
      }

      return (await response.json()) as T;
    },
  };
}
