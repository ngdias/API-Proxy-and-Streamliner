# Code Comments

Some personal notes for future reference and context.

## Classes to asynchronous factory functions due to async initialization

Both `HttpProxyTunnel` and `ProxyTunnelClient` were originally implemented as classes, primarily for syntactic convenience. However, the initialisation tasks involving `CreateRemoteLibrary()` are inherently asynchronous but require completion before the instances are ready for use.

JavaScript class constructors cannot be declared `async` and therefore cannot directly `await` asynchronous initialisation tasks. Accommodating this with classes requires additional workarounds, such as separate asynchronous initialisation methods.

Since class-specific features are not essential for either implementation, refactoring both classes into asynchronous factory functions provides a simpler solution: the factories can await the required initialisation tasks before returning the fully initialised objects without introducing any extra complexity.

## logger.js

The class DualLogger initially was handling both console and file output via Pino, but Pino works asynchronously and that was messing up the correct display of the status line at the bottom of the console window.

In a more straighforward display logging scenario where Pino would handle both cases, the colour object `c` and also `levels` wouldn't be necessary.

### #printLog(level, ...args) {}

- respects Pino ordering preference of object first

- switches the ordering in the console output for improved readability

## Generator function to cycle through request rates

The main reason for using a generator is to maintain an iterator's position across successive status updates, allowing the status line to cycle through the entries in `APIendpoints` without manually tracking an index.

The generator is not strictly necessary. One could implement the same behaviour using an array of keys and a manually maintained index. However, that would require additional logic to handle index wrapping and changes to the map.

The generator expresses the intended behaviour directly: yield each endpoint in turn, then start again indefinitely, yielding `null` when there are no endpoints to report.

The generator supports cyclic iteration without requiring a fixed snapshot of the map for each cycle. This is useful in this case, where the set of active endpoints can change at runtime.

Calling the generator function returns a generator object without immediately executing its body. Each call to `.next()` resumes execution until the next `yield` or until the generator finishes.

The outer `while (true)` loop keeps the generator running indefinitely, allowing it to produce values repeatedly.

**When `map` is empty:**

1. the generator checks `map.size === 0`
2. it yields null, suspending execution at that point.
3. the next call to `.next()` resumes execution immediately after `yield null`
4. the loop starts another iteration and checks `map.size` again

This means the generator does not terminate when the map is empty. If entries are added later, the next iteration can detect them and begin yielding entries instead.

**When `map` contains entries:**

1. the generator checks `map.size === 0` and finds that the map is not empty
2. it executes `yield* map.entries()`
3. the `yield*` expression delegates iteration to the iterator returned by `map.entries()`, yielding each `[key, value]` pair in insertion order
4. once all entries have been yielded, the delegated iterator is exhausted
5. execution resumes after `yield*`, reaches the end of the `while` body, and starts the next iteration
6. the generator checks the Map's current size and either yields null or starts another cycle through its entries

The generator therefore maintains its execution state between calls. The `yield*` expression handles iteration over the Map's entries, while the outer loop starts a new cycle whenever the current iteration is exhausted.

## Retry timing

The retry logic uses server-provided retry timing information when available, falling back to exponential backoff otherwise.

The current retry delay precedence is:

```text
Retry-After
X-RateLimit-Reset
exponential backoff
```

Each option is considered in order, using the first valid delay that can be determined.

Additional rate-limit headers are intentionally not supported without a concrete API requiring them.

Although rate-limit headers can provide useful information, their semantics are not always consistent across APIs. In particular, `X-RateLimit-Reset` does not have a universally consistent interpretation: its value may represent an absolute timestamp, a relative delay, or an API-specific convention.

Supporting additional headers without accounting for their documented semantics could therefore produce incorrect retry delays rather than improve reliability.

If a concrete API requires support for another header, such as `RateLimit-Reset`, it can be added based on the API's documented behaviour.

## Endpoint and server data structures

Both clients maintain two maps to manage the configured remote servers and their endpoints. This is intentional: the two maps provide efficient access to parts of the same configuration data from two different perspectives.

The primary `endpointMap` is indexed by endpoint name because the endpoint is the searcheable unit used when making requests. An endpoint properties can therefore be retrieved directly when constructing the request URL and options:

```js
endpointMap.get(label)
```

Each endpoint currently contains the properties required to construct a request, including the properties shared by all endpoints belonging to the same remote server:

```js
endpointMap.set(endpointName, {
    host: remoteConfig.host,
    port: remoteConfig.port,
    protocol: remoteConfig.protocol,
    headers: remoteConfig.headers,
    rateLimit,
    ...endpoint
});
```

This representation makes request handling straightforward, but has a structural disadvantage: server-level properties are repeated for every endpoint belonging to that server. If several endpoints use the same remote authority, `host`, `port`, `protocol`, and other common properties are stored repeatedly.

The second map addresses a different requirement. Request-rate reporting is performed per remote server rather than per endpoint. A server can expose multiple endpoints, so calculating the server's request rate from `endpointMap` would require traversing all endpoints and aggregating their individual request counts. Maintaining a separate server-indexed structure makes this operation direct, at the cost of some duplication and increasing the cognitive load required to understand the overall structure of the code:

```js
requestCounts.get(hostPort)
```

The two maps therefore represent two different indexes:

- **endpointMap**: endpoint label → endpoint / request configuration

- **requestCounts**: host:port → server / request statistics

Consequently, this is not simply duplicated information serving the same purpose. Each map is optimized for a different operation: request construction is endpoint-oriented, while rate reporting is server-oriented. The redundancies lie in the fact that common server configuration is duplicated across endpoint entries in `endpointMap`, and that the information represented by both Maps could ultimately be consolidated into a single hierarchical Map.

### Why the structures cannot simply be hierarchical

A more natural representation of the underlying domain would be hierarchical, matching the imported configuration object structure:

```text
Server
├── common server properties
├── request statistics
└── endpoints
    ├── endpoint
    ├── endpoint
    └── endpoint
```

This would eliminate the repeated server properties and make the server/endpoint relationship explicit. Server-level operations would also become straightforward because the endpoints are structurally contained by their server.

The difficulty is that the request machinery also requires reverse endpoint-to-server lookup. A JavaScript object hierarchy naturally provides downward traversal:

```text
server → endpoints → endpoint
```

but JavaScript objects do not provide the inverse operation:

```text
endpoint → parent server
```

JavaScript objects have no intrinsic knowledge of the object or property through which they were reached. Given:

```js
const root = {
    server: {
        endpoints: {
            users: {}
        }
    }
};
```

the `users` object does not automatically know that it is contained by `endpoints`, `server`, or `root`. There is no native `parent` property for ordinary JavaScript objects.

This is different from structures such as the DOM, where parent and child relationships are explicitly part of the node abstraction.

### Possible alternatives

Several approaches could eliminate or reduce the current duplication.

1. **Hierarchical structure**

    The data could be represented primarily as servers containing their endpoints:

    ```text
    serverMap
        └── server
            └── endpointMap
                ├── endpoint
                ├── endpoint
                └── endpoint
    ```

    This provides a single authoritative representation and eliminates repeated server properties. The disadvantage is that locating an endpoint by name requires either traversing the servers or maintaining an additional endpoint index.

2. **A custom hierarchical class**

    A relatively small custom abstraction could provide the missing parent/child semantics without requiring a general-purpose tree library. Adding a child establishes the reverse parent relationship automatically:

    ```js
    class MenuItem {
        constructor(data) {
            Object.assign(this, data);
            this.children = [];
        }

        addChild(item) {
            item.parent = this;
            this.children.push(item);
        }
    }
    ```

    A similar approach could be adapted to the proxy's domain. A `Server` class could own its endpoints, while an `Endpoint` instance could retain the server that created it. The important property is that the relationship is established by the abstraction using internal JS references rather than declarative static properties. The reverse reference is technically stored as a property, but the method that creates the property also creates the relationship and enforces the consistency.

    This creates a genuine bidirectional object relationship.

    A further refinement could use a builder to crawl the existing declarative configurations (the objects in the `conf/` folder) and construct the hierarchy automatically. This would allow the configuration to remain simple while the runtime representation becomes hierarchical:

    ```text
    configuration object
            │
            ▼
        hierarchy builder
            │
            ▼
    RemoteServer
        └── RemoteEndpoint
    ```

    This approach could require relatively little code for the specific two-level hierarchy used by the client and would avoid introducing a general-purpose dependency.

3. **A hierarchical data-structure library**

    There are also JavaScript libraries specifically designed to represent trees and bidirectional parent/child relationships. Conventional tree libraries generally create explicit node objects whose APIs provide operations such as adding children, finding parents, traversing descendants, and navigating ancestors.

    For example:

    - [Treecle](https://github.com/mavoweb/treecle/tree/main)
    - [tree-util](https://www.npmjs.com/package/tree-util)
    - [js-hierarchy](https://www.npmjs.com/package/js-hierarchy)

    These fall into somewhat different categories, and not all are designed to work directly with an existing configuration object hierarchy. Such a library would therefore need to be evaluated and configured appropriately before being adopted.

4. **Hierarchical structure with a separate endpoint index**

    Another approach is to make the hierarchical server structure the source of truth while maintaining an endpoint index purely as a derived lookup index:

    ```text
                    authoritative structure
                            │
                            ▼
                        servers
                            │
                        ┌────┴────┐
                        │         │
                    server    server
                        │
                    endpoints
                    /    |    \
                ep1   ep2   ep3
                    ▲     ▲     ▲
                    └─────┴─────┘
                    endpointMap
    ```

    This gives efficient lookup in both directions while keeping the actual server/endpoint relationship hierarchical. The disadvantage is that the derived index must remain synchronized with the authoritative structure.

### Current dual-map implementation

The current implementation is a pragmatic trade-off:

- request construction remains simple and direct;
- server-level rate reporting remains simple and direct;
- no traversal or aggregation is required during normal operation;
- no custom tree/node abstraction is required;
- common server properties are repeated across endpoints;
- the conceptual relationship between an endpoint and its server exists in two separate representations.

The redundancy is workeable but not ideal; this remains an area for potential refinement.