# Rate limiters

The project implements two rate limiters, one used by the proxy and one used by the direct `fetch()` client.

Both aim to pace requests as closely as possible to the configured rate limit without exceeding that value. Two additional requirements influenced their design:

- **Rolling-window limits:** the proxy limiter requires additional tooling and careful placement of request-history timestamps to approximate the timing observed by the remote server as accurately as possible.

- **Asynchronous bursts:** both limiters had to be adapted to support multiple requests arriving before previous requests had been released. This requires queueing and additional scheduling logic compared with a limiter designed exclusively for sequential requests.

Neither implementation should currently be considered a generally optimal or production-proven rate-limiting algorithm. They deliberately use different scheduling approaches:

- **Proxy:** pre-schedules queued requests using calculated future release times.
- **Direct:** maintains a queue and releases requests recursively as the previous scheduling interval expires.

The implementations evolved through iterative testing against real APIs, identifying timing and queueing problems, and adapting the algorithms to the requirements of the project. This process also provided an opportunity to explore the trade-offs between different scheduling approaches, the complexity introduced by asynchronous requests, and the extent to which scheduling logic can be encapsulated in a single function or requires additional coordination across the codebase.

The implementations are intended primarily as practical mechanisms for API scraping, while allowing experimentation and a deeper understanding of the different alternatives, rather than as fully optimized general-purpose rate limiters.

## Proxy rate limiter

The proxy maintains a queue of requests and calculates a future target time for each request when it enters the queue.

Instead of maintaining a queue of callbacks waiting for authorization, the limiter calculates the intended future release time of each request and relies on JavaScript timers to schedule their release.

This approach makes asynchronous bursts relatively straightforward: multiple requests can be accepted and assigned their respective positions in the schedule without waiting for earlier requests to be released first.

The limiter also maintains request history and uses it when calculating subsequent release times. This allows it to account for requests within a rolling window, rather than relying exclusively on a fixed interval.

For example, a limit of 10 requests per 60 seconds is equivalent to a nominal interval of:

```text
60000 / 10 = 6000 ms
```

Requests can therefore be paced at approximately six-second intervals while the request history is used to track the rolling-window limit.

The main disadvantage of pre-scheduling is that the calculated release time cannot guarantee when the request will actually reach the remote server. JavaScript timers do not guarantee exact execution times, and scheduling delays, network latency, and processing overhead introduce additional variation.

The proxy's Agent configuration, which forces requests to the same remote authority to be delivered sequentially, helps limit the number of requests that can accumulate in the effective in-flight queue. With the current Agent configuration, testing shows that the proxy has at most one request waiting for dispatch, even when an asynchronous burst adds 100 requests to the Agent's internal queue. This can reduce the practical impact of scheduling drift, although it does not eliminate timing discrepancies between the local schedule and the remote server's observations.

The implementation is therefore sensitive to when a request is registered in the request history. The closer that timestamp is to the actual dispatch of the request, the more accurately the rolling-window calculation approximates the remote server's view.

This remains an area for potential refinement.

## Direct rate limiter

The direct `fetch()` client also maintains a queue, but uses a Promise-based mechanism rather than pre-establishing the release time of every queued request.

The limiter waits for the required interval before releasing the next request. This scheduling process continues recursively until the queue is empty.

The approach is relatively simple and naturally incorporates some overhead lag between requests. Request execution, response processing, and other asynchronous operations can introduce additional time between dispatches, resulting in a lower effective request rate than the configured maximum.

Unlike the proxy limiter, the current implementation does not explicitly track rolling-window occupancy or maintain request history for this purpose.

This has been sufficient for the APIs tested so far. Where additional timing margin is required, the effective rate can be reduced by increasing the calculated interval between requests.

For example, configuring the limiter to operate at approximately 95% of the documented maximum request rate introduces a small margin without changing the underlying scheduling mechanism.

An earlier version of this limiter used event emitters rather than Promises to coordinate the release of queued requests.

## Why are the implementations different?

The two implementations evolved independently while testing different approaches to the same problem.

In retrospect, the recursive queue-release approach used by `fetch()` may be a better fit for the proxy, potentially combined with additional tooling to enforce rolling-window limits more explicitly.

These possibilities remain open for future refinement. The current implementations reflect the approaches explored during development rather than a definitive choice of the best algorithm for each client.

## Rolling windows

Rolling-window handling is **currently relevant primarily to the proxy limiter**, while also enabling the configuration of rates below one request per second.

`rollingWindow` is specified in milliseconds and defines the period over which request history is evaluated.

`rateLimit` specifies the maximum number of requests allowed within that period.

For APIs that enforce a rolling-window limit, the `rollingWindow` value must equal the rolling window time in milliseconds, and `rateLimit` should be set to the maximum allowed number of requests during that period.

For rates above one request per second and no rolling window calculation method, 1000 ms should be considered as the default value.

For rates below one request per second, `rollingWindow` should equal the minimum allowed time between requests and the `rateLimit` should be set to 1.

### Case: 1 request every 2 seconds

A rate of 0.5 requests/second can be represented as:

```text
rateLimit      = 1
rollingWindow  = 2000 / 1 = 2000 ms
```

With a capacity of one, the most recent request therefore determines the earliest possible dispatch time for the next request.

### Case: 10 requests per minute

A rate of approximately 0.166 requests/second can be represented as:

```text
rateLimit      = 1
rollingWindow  = 60000 / 10 = 6000 ms
```

Under steady traffic, requests would therefore be paced approximately six seconds apart.

The combination of the calculated interval and request history ensures that no more than ten requests are scheduled within the configured rolling 60-second window.

The `rollingWindow` setting could be omitted for most configurations above one request per second, so it defaults instead to 1000 ms, so that `rateLimit` can directly represent the maximum allowed requests per second. It is currently kept explicit because makes the configuration uniform and self-documents the need to pay attention to that setting in special cases.

## Request size

The rate limiters do not distinguish between small requests and potentially larger `POST` or `PUT` requests.

They currently model rate limits in terms of request count rather than request size, payload size, bandwidth, or server processing cost.

This is intentional. APIs that impose additional limits based on payload size or other resource measurements would require a different limiting model.

## Queued request cancellation

Queued requests cannot currently be cancelled.

I have not identified an use case for cancellation in the current API-scraping context that justifies the additional state management and synchronization required to support it.

The current implementations do not include explicit cancellation handling for queued requests. Their queue and scheduling logic is designed to coordinate request insertion, scheduling, and release, but the absence of cancellation does not, by itself, establish that the implementations are free of race conditions.

Cancellation may be revisited if a use-case arises where requests can become obsolete while waiting in the queue.
