# Direct client using Node.js' built-in `fetch()`

The direct client uses Node.js built-in `fetch()` for HTTPS requests. Unlike `https.request()`, `fetch()` is backed by **Undici**, which manages its own connection pooling and connection reuse.

No `https.Agent` is therefore required for connection persistence. When possible, Undici reuses existing TCP/TLS connections between requests to the same remote server, avoiding the overhead of establishing a new connection and TLS handshake for every request.

Undici's connection management is separate from the `https.Agent` mechanism used by Node's lower-level `https` API. Custom connection-pool configuration is only necessary when the client needs behavior beyond the defaults, such as explicitly controlling concurrency or pool characteristics. Node's built-in `fetch()` supports custom connection management through its `dispatcher` option.

Request-body handling also differs between the two APIs. With `fetch()`, the request body is supplied through the body property of the options object passed to the function. With the lower-level `http.request()` API used in the proxy-connected implementation, the body is written to the request using `.write()` or `.end(body)`.

The direct client also benefits from the built-in timeout mechanism provided by `AbortSignal.timeout()`, which allows a fetch operation to be aborted automatically after a specified duration.

## HTTP response handling

Unlike `https.request()`, which exposes the response through an `IncomingMessage` object and its associated events, `fetch()` resolves to a `Response` object. The response body is exposed as a stream and must be consumed explicitly, for example by calling `await response.json()` to parse a JSON response.

An important distinction is that `fetch()` does not reject its promise simply because the server returns an HTTP error status. The client must inspect the response status and implement the appropriate handling itself. Although the two APIs expose responses differently, both implementations apply the same response-handling logic.

## Local rate limiting

Without a proxy handling request pacing, the direct client needs to manage its request queue and rate limiting locally. 

This has an important implication when multiple client processes access the same remote API. Since separate processes do not automatically share a common limit, the direct client cannot enforce a coordinated rate limit across those processes. The proxy-connected implementation overcomes this limitation by delegating rate limiting to the proxy, which coordinates requests across connected clients.