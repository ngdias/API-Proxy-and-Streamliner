# Proxy tunnel

The proxy uses the **HTTP** CONNECT method to establish a TCP tunnel and passes **HTTPS** traffic through without terminating TLS. Consequently, the proxy cannot inspect individual HTTP requests, headers, authentication, or payloads. Its role is limited to managing connections and applying traffic controls.

This makes it possible to pool HTTPS requests from multiple concurrent sources without the additional complexity of setting up a TLS-intercepting **HTTPS** proxy. Such an implementation would require, among other things, a certificate authority trusted by the clients, dynamically generated certificates for remote hosts, and appropriate certificate and private-key management. It could also introduce compatibility issues with certificate pinning and client certificate authentication. The pass-through approach avoids these requirements because TLS remains end-to-end between the client and the remote server.

The architecture is essentially:

```
HTTP CONNECT
     ↓
TCP tunnel
     ↓
TLS / HTTPS traffic
     ↓
Remote API
```

Consequently, the server has no direct access to individual HTTPS requests. An approximation is made through the **`clientSocket`** on('data') listener, but this is not a strict or reliable measure of the number of requests sent to the remote server.

Empirically, the listener appears to trigger only once per request in the current implementation. However, a raw socket data event does not correspond to an HTTP request boundary. It could reflect arbitrary TCP chunking:

- One HTTPS request can produce several data events
- Several HTTPS requests can arrive in a single data event
- Data received immediately after the CONNECT headers may be passed separately through the head argument of the server's connect event
- Chunking can vary with payload size, timing, buffering, TLS record construction, network conditions, and Node.js runtime behaviour.

On the other hand, configuring the `https.Agent` with `maxSockets: 1` serialises requests handled by that Agent for a given destination, queuing additional requests until the socket becomes available again. This can reduce concurrency and some of the burstiness associated with overlapping requests, but it does not guarantee any particular relationship between individual requests and socket data events.

The observed empirical pattern is therefore a useful handle given the implementation constraints, but it is not a guarantee on which the rate limiter can safely depend in all circumstances. It is a byte-stream pacing heuristic, not request-level enforcement.

The testing and extensive usage this implementation has endured demonstrate that this is an acceptable approach for avoiding bursts and encouraging polite request pacing. It is strictly not sufficient to guarantee a hard limit, such as never issuing more than N requests reaching the remote per minute.

The smallest way to obtain deterministic shared throttling, without moving the agents to the proxy or decrypting HTTPS, is to introduce a separate permit step. Before each outbound URL attempt, the client requests permission from the proxy through a small control-plane call. The proxy coordinates these permits according to its shared rate limit, and the client proceeds with the HTTPS request only after obtaining one. This mechanism supplements rather than replaces the CONNECT tunnel.

At present, no permit mechanism is implemented. Empirically, the proxy works well as a standalone tool that can be connected to different API clients with minimal configuration. Introducing permits would require additional, purpose-built logic on both the server and client sides.

The aim here is to demonstrate a viable, standalone HTTP pass-through proxy for HTTPS traffic. The client-side implementation serves just as a demonstration of resilience and endurance, as well as a solution that abstracts and streamlines API calls independently of the chosen connection method.

## The three proxy timeout listeners

The three proxy timeout listeners are not necessary for this particular proxy implementation. Each listener reports inactivity on a different level of the connection handling:

- `proxyServer` timeout: Reports inactivity on a client connection accepted by the HTTP server. It is a server-level notification associated with the client-facing socket.

- `clientSocket` timeout: Reports inactivity on the connection between the client and the proxy.

- `targetSocket` timeout: Reports inactivity on the connection between the proxy and the remote server.

The server-level and `clientSocket` timeout notifications can overlap because they concern the same underlying client-facing connection. The `targetSocket` timeout, however, concerns the separate connection to the remote server.

These are inactivity timeouts, not overall request-duration limits. A timeout event does not, by itself, indicate why the connection became inactive or establish that the remote server or socket is unusable. Emitting a timeout event does not automatically close the socket; the application must explicitly close or destroy it if that is the necessary behaviour.

In this implementation, the timeout listeners currently only log the events. The operational instrumentation relevant to request failures, error handling, and retry logic is instead located at the request layer, where the middleware can act on the outcome of an individual request. Consequently, these proxy-level listeners provide little practical value for the current design and can be omitted.

For the same reason, explicitly setting `proxyServer.timeout` is unnecessary. Node.js HTTP servers have a default `server.timeout` value of 0, meaning that no inactivity timeout is imposed on incoming connections by default. The explicit timeout configuration is therefore also unnecessary, provided that no server-level inactivity policy is required.

An important distinction to make is that request-level timeouts and socket inactivity timeouts are not equivalent. A request timeout limits how long the client waits for an operation, whereas a socket inactivity timeout measures how long a connection remains inactive. The former is the relevant mechanism for the middleware's request handling and retry strategy; the latter would only need to be configured if the proxy itself required an inactivity policy or additional connection-level diagnostics.

## proxyServer.on('connect', handleConnect.bind(this));

The `.bind(this)` call ensures that `handleConnect` retains the correct `this` context when invoked as an event handler. Without it, the function would not automatically retain the `proxyServer` instance as its execution context when called by the event emitter. 

Extracting the handler into a separate function keeps the event registration concise and separates the rather extensive connection handling logic from the server initialisation code, making the main organisational function easier to read and maintain.

## async function handleConnect(request, clientSocket, head) {}

- `clientSocket` represents the connection between the client and the proxy.
- `targetSocket` represents the connection between the proxy and the remote server.

For the sake of completeness, all the relevant event listeners are implemented, even if without any meaningful role. If a future situation arises where custom behaviour is required, they are already in place.

The exceptions are these 6 listeners for `clientSocket` connections:
- clientSocket.on('connect', ...)
- clientSocket.on('ready', ...)
- clientSocket.on('connectionAttempt', ...)
- clientSocket.on('connectionAttemptFailed', ...)
- clientSocket.on('connectionAttemptTimeout', ...)
- clientSocket.on('lookup', ...)

Of the two sockets, `clientSocket` is the one that already exists because at this point the HTTP server has already accepted the client's CONNECT request.  The connection to the remote server is established separately through `targetSocket`. Therefore, at that point these listeners if they existed had already been fired and so do not provide useful information about connection establishment when attached to `clientSocket`.