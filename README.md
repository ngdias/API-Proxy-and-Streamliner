# API Proxy & Streamliner

The project consists of the pass-through proxy itself and two interchangeable API client middleware implementations.

- A lightweight Node.js HTTP CONNECT pass-through proxy for routing and throttling **HTTPS** API traffic without terminating or inspecting TLS.

- A middleware layer that abstracts the construction of API `GET` and `POST` requests, reducing client-side API calls to variable assignment and a single-line request statement.

> The pass-through proxy was created to address a real-world need: having multiple concurrent processes originating from the same IP address sending requests to a remote API server, and managing the request queue to respect the remote API's rate limit.

The proxy's main features are:

- supports routing traffic to multiple permitted remote *authorities* (`host:port`) concurrently. This means that it can distinguish traffic to different ports accepting requests on the same destination server
- pools the API requests from all clients and enforces global rate limits per destination authority. The available rate limit is thus shared dynamically among the client processes that are actively sending requests
- an access-control mechanism not primarily for security, but as the means to guarantee explicit configuration of each remote authority and its rate limit
- supports both sequential requests and concurrent bursts of requests
- supports arbitrarily low rate limits (i.e. below 1 request per second)
- logs to the console via a custom implementation and to a file via [Pino](https://github.com/pinojs/pino)
- provides minimal real-time request-rate reporting via the console

The known limitations are:

- only supports a single rate-limit rule, typically expressed as a maximum number of requests per second. In other words, you can't define separate limits per day, hour and minute, for example
- there is no request prioritization logic
- large request payloads have not been tested and may not be throttled accurately. The current implementation has only been tested with small payloads. For more details, see the implementation notes linked at the end of this document

Additionally, I provide two **interchangeable** middleware implementations to support client requests. Swapping them consists of simply changing an imported module. They handle the dynamic URL construction, the options and body objects, the error handling and retry logic:

1. Uses the HTTP CONNECT method to establish a TCP tunnel and a persistent Agent via the pass-through **proxy** to manage the connection and traffic;

2. Uses Node's built-in `fetch()` for a **direct** connection (no proxy). This is intended for cases where multiple processes do not need to share a rate limit. In other words, only one process is making requests to a particular destination authority. This version provides the same transparent request construction, error handling, and retry logic, while also handling the request queue and rate limiting locally, rather than relying on the proxy to do so. It also shares the same known limitations, except for the potential request size limit.

The middleware implementations expect API responses in JSON format; the pass-through proxy itself is not restricted to JSON traffic.

The middleware implementations fall back to a low-frequency heartbeat mode if they encounter persistent recoverable errors, rather than giving up or skipping requests.

The code executes a no-tolerance policy for unrecoverable or unknown connection errors. This is intentional: if there is a mistake in the URL or execution encounters an error it is not prepared to handle, the error is reported and the application is terminated so that the error can be fixed or diagnosed (fail-fast approach). When embedding either middleware in a larger application that should not be terminated by such an error, the error propagation stack is already in place, and it is simply a matter of raising a new custom error instead of terminating the application.

I provide test client files to a number of public remote servers (scripts ending in '_request.js') to demonstrate both the simplified request interface and the middleware's support for different types of requests:

- typical `GET` requests with search parameters, with or without custom headers (including authentication keys). See the [GitHub configuration file](lib/conf/github.js) for an authentication example; and most of the other servers for typical `GET` examples

- static requests: no variable element in the URL (see the GitHub example)

- `GET` requests with variables in the pathname ([GBIF](lib/conf/gbif.js), [PRIDE](lib/conf/pride.js))

- `POST` requests with custom headers and body (see the GitHub example)

## Usage

### Server configuration

In the `lib/conf/` folder create an appropriately named configuration file *for each* server you intend to access, or adjust the existing examples to your needs. File names starting with 'pino' or 'proxy' are ignored; everything else is imported automatically. If you are just going to use the proxy and plug in your own client implementation, all you need is

```js
const remoteConf = {
    host: 'api.servernameOrIP.com',
    protocol: "https:",
    port: 443,
    rateLimit: 5, // requests per second
    rollingWindow: 1000, // in milliseconds
}

export default remoteConf;
```

For a typical API server that allows multiple requests per second, set `rateLimit` to the maximum permitted number of requests per second and leave `rollingWindow` at the default 1000 milliseconds.

If the API server enforces a rolling check for request limits, `rollingWindow` **must** match the time window. For example, if Envoy enforces 25 requests per rolling 5 seconds, `rollingWindow` must be set to 5000 and `rateLimit` to 25.

For a slow server (e.g. free access intended mainly for prototyping) with a rate limit below 1 request per second, set `rateLimit` to 1 and `rollingWindow` to the minimum interval between requests, in milliseconds. For example, if the limit is 5 requests *per minute*, calculate 

> 1 / (5 requests per minute / 60 seconds) * 1000 ms = 12000 ms

or

> 60 seconds * 1000 ms / 5 requests = 12000 ms per request

Add some margin for network jitter, etc., so in this example 13000 ms should prevent most 429s, while an exact 12000 ms will still hit rate limit errors very often.

### Endpoint configuration

If you choose to take advantage of the middleware implementation, the same server configuration file described above will also need to contain the endpoint(s) configuration. Expand the `remoteConf` object to include all the necessary information to assemble URL requests and options. You will need to create a unique **label** and define the endpoint configuration for each endpoint you need to access. 

Note that you can define not only the variable components in each request, but also omit search parameters from the client call, for example to tailor the same endpoint to different output requirements. This feature is demonstrated in some of the client examples provided (e.g. [meteo_request.js](lib/meteo_request.js)).

Below is an example configuration for [OpenAlex](https://openalex.org/), with two configured endpoints. Note that the first endpoint has a static pathname and variable search parameters, while the second endpoint doesn't require search parameters and the variable parts go directly on the pathname. To add more endpoints under the same remote authority it's just a matter of expanding the `endpoints` object with more nested objects following the same pattern.

```js
const remoteConf = {
    host: 'api.openalex.org',
    protocol: "https:",
    port: 443,
    rateLimit: 5, // requests per second
    rollingWindow: 1000, // in milliseconds
    headers: {},
    endpoints: {
        OA_filter: { // unique label
            method: 'GET',
            pathname: `/works`,
            build: ({ filter, per_page, cursor }) => ({
                searchParams: {
                    api_key: OA_API_KEY,
                    filter,
                    per_page,
                    cursor
                }
            })
        },
        OA_singleton: {
            method: 'GET',
            searchParams: {},
            build: ({ prefix, id_mag }) => ({
              pathname: `/works/${prefix}${id_mag}`  
            })
        }
    }
}
```

You can leave `headers`, `body` and `searchParams` as empty objects when there are no values to include, or you can omit them. See the [GitHub configuration file](lib/conf/github.js) and the [OpenAlex configuration file](lib/conf/open_alex.js) for demonstration examples.

Also note that the `build()` function only needs to contain `key:value` pairs for configuration elements that actually need to change from request to request. Any static elements can be placed outside.

Both cases are demonstrated in the example above and in the other server configuration files.

### Client requests

Once the remote server and endpoints are set up correctly, issuing client requests becomes extremely straightforward. First, import the asynchronous factory function `APIManager`. **To use the proxy**, import `api_client.js`:

```js
import APIManager from './modules/api_client.js';
```

**For a direct connection** using `fetch()` instead, import `api_manager.js`:

```js
import APIManager from './modules/api_manager.js';
```

Second, initialise `APIManager`, which again makes use of a custom, mixed logging implementation. Note that, for brevity, this usage guide omits the setup of the custom logging tooling, which can be removed or replaced as desired with minimal changes to the existing code.

`requestStats` is not mandatory, but is used in every client example provided.

```js
const logger = new Logger(pinoClient, 30);

const { fetchData, requestStats } = await APIManager(logger);
```

Then each API call is just a matter of passing along the endpoint label (which should be unique across the entire application) and any required variables and search parameters:

```js
const request = await fetchData('OA_filter', { filter, per_page, cursor });
```

A basic block with variable assignments and console reporting looks like this:

```js
const filter = 'publication_year:2020';
const per_page = 1;
const cursor = '*';

const request = await fetchData('OA_filter', { filter, per_page, cursor });

console.log(request);
```

## Installation & usage

Download or clone the repository, make sure **Node.js and npm** are installed (current LTS version recommended). The only external project dependency is Pino. If you don't need file logging, you can remove the Pino-related code and run the code without installing that dependency. Otherwise:

```bash
npm install
```

Start the local proxy server, if you are going to use it:

```bash
npm run server
```

Finally, run one of the demonstration scripts ending in '_request.js', after commenting or uncommenting settings as appropriate:

```bash
node lib/gbif_request.js
```

- each file can send requests either via the proxy or directly, by enabling the corresponding import

- each file includes 1-4 test modes, selected by changing the comments on the function calls at the top of the file.

## Implementation notes

- [General notes](docs/code_comments.md) on some of the architectural choices

- Notes on the [proxy tunnel](docs/proxy_tunnel.md)

- Notes on the [direct client](docs/direct_client.md)

- Notes on the [rate limiters](docs/rate_limiters.md)

## License

**API Proxy & Streamliner** is licensed under the MIT License.

See the [LICENSE](LICENSE) file for the full license text.
