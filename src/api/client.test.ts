import { createApiClient } from './client';

describe('createApiClient', () => {
  test('adds the current bearer token to requests', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const getToken = jest.fn().mockResolvedValue('access-token');
    const client = createApiClient('https://api.example.com', getToken, fetchImpl);

    await client.request('/books');

    expect(getToken).toHaveBeenCalledWith(false);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/books',
      expect.any(Object),
    );
    const requestHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(requestHeaders.get('Accept')).toBe('application/json');
    expect(requestHeaders.get('Authorization')).toBe('Bearer access-token');
  });

  test('preserves caller headers', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient(
      'https://api.example.com',
      async () => 'access-token',
      fetchImpl,
    );

    await client.request('/books', {
      headers: new Headers({ 'X-Request-ID': 'request-123' }),
    });

    const requestHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(requestHeaders.get('X-Request-ID')).toBe('request-123');
    expect(requestHeaders.get('Authorization')).toBe('Bearer access-token');
  });

  test('fails before fetching when no token is available', async () => {
    const fetchImpl = jest.fn();
    const client = createApiClient('https://api.example.com', async () => null, fetchImpl);

    await expect(client.request('/books')).rejects.toThrow('Sign in is required.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('normalizes a trailing slash in the base URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient(
      'https://api.example.com/',
      async () => 'access-token',
      fetchImpl,
    );

    await client.request('/books');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/books',
      expect.any(Object),
    );
  });

  test('throws a FastAPI detail string for non-ok responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Book not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient(
      'https://api.example.com',
      async () => 'access-token',
      fetchImpl,
    );

    await expect(client.request('/books/missing')).rejects.toThrow('Book not found.');
  });

  test('extracts messages from structured FastAPI details', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [
            { loc: ['body', 'title'], msg: 'Field required', type: 'missing' },
            { loc: ['body', 'file'], msg: 'Unsupported format', type: 'value_error' },
          ],
        }),
        {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const client = createApiClient(
      'https://api.example.com',
      async () => 'access-token',
      fetchImpl,
    );

    await expect(client.request('/books')).rejects.toThrow(
      'Field required; Unsupported format',
    );
  });

  test('does not expose HTML error bodies', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response('<html>internal proxy error</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const client = createApiClient(
      'https://api.example.com',
      async () => 'access-token',
      fetchImpl,
    );

    await expect(client.request('/books')).rejects.toThrow(
      'Request failed with status 502.',
    );
  });

  test('refreshes the token and retries once after a 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Expired token.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const getToken = jest
      .fn()
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('refreshed-token');
    const client = createApiClient('https://api.example.com', getToken, fetchImpl);

    const response = await client.request('/books');

    expect(response.status).toBe(204);
    expect(getToken).toHaveBeenNthCalledWith(1, false);
    expect(getToken).toHaveBeenNthCalledWith(2, true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer refreshed-token');
  });

  test('does not retry more than once after repeated 401 responses', async () => {
    const unauthorized = () =>
      new Response(JSON.stringify({ detail: 'Still unauthorized.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(async () => unauthorized())
      .mockImplementationOnce(async () => unauthorized());
    const getToken = jest
      .fn()
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('refreshed-token');
    const client = createApiClient('https://api.example.com', getToken, fetchImpl);

    await expect(client.request('/books')).rejects.toThrow('Still unauthorized.');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  test('does not set a JSON content type for binary request bodies', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient(
      'https://api.example.com',
      async () => 'access-token',
      fetchImpl,
    );

    await client.request('/uploads', {
      method: 'POST',
      body: new Blob(['binary-content']),
    });

    const requestHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(requestHeaders.has('Content-Type')).toBe(false);
  });

  test('serializes JSON request bodies and parses typed JSON responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'book-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient(
      'https://api.example.com',
      async () => 'access-token',
      fetchImpl,
    );

    const result = await client.json<{ id: string }>('/books', {
      method: 'POST',
      body: { title: 'Example' },
    });

    expect(result).toEqual({ id: 'book-1' });
    expect(fetchImpl.mock.calls[0][1]?.body).toBe(JSON.stringify({ title: 'Example' }));
    const requestHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(requestHeaders.get('Content-Type')).toBe('application/json');
  });

  test('returns undefined from the JSON helper for a 204 response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient(
      'https://api.example.com',
      async () => 'access-token',
      fetchImpl,
    );

    await expect(client.json('/books/current')).resolves.toBeUndefined();
  });
});
