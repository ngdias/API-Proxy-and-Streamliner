/**
 * Module that builds API URLs, sends requests, applies retries, 
 * and returns parsed JSON.
 * 
 * For tasks without concurrency / for single requests
 * 
 * Uses fetch()
*/

import { join } from "node:path";
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from "node:url";

import { cyclicMapIterator } from './utilities.js';

const APIManager = async (logger) => {

    let delay;
    const MAX_ATTEMPTS = 50;
    let paddingHostPort = 0; // to align the status line

    const requestCounts = new Map();
    const serversIterator = cyclicMapIterator(requestCounts);

    /**
     * Backing off exponentially between request attempts
     * 
     * 120 is the ceiling, 118 ensures delay starts at 5s on attempt = 1
     * The speed: change 0.035 - making it higher (ex. 0.05) makes the curve flatten out faster; 
     * making it lower (ex. 0.02) stretches out the middle attempts even more.
     * 
     * The jitterFactor generates a random factor between 1.00 and 1.10 (0% to 10% increase)
    */
    const backOffExp = (attempt) => {

        const baseDelay = 120 - 118 * Math.pow(2, -0.035 * attempt);

        const jitterFactor = 1 + (Math.random() * 0.10);

        return Math.round(baseDelay * jitterFactor);
    };

    const retryPause = async (ms, attempt, msg, error = {}) => {

        if (attempt <= MAX_ATTEMPTS) { 
            logger.error({ error }, msg);
            return new Promise(resolve => setTimeout(resolve, ms));
            
        } else {
            logger.error({ error });
            logger.warn(`fetchData(): Heartbeat mode. Retry #${attempt + 1} in 30 minutes`);
            return new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000));
        }
    };

    /** Expects a date or time in seconds  */
    const parseRetryAfter = (retryAfter) => {

        logger.debug("retryAfter:", retryAfter);

        if (!retryAfter) {
            return null;
        
        } else if (Number(retryAfter) && retryAfter >= 0) {
            return Number(retryAfter);

        } else if (!Number.isNaN(Date.parse(retryAfter))) {
            const diffSeconds = Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
            return Math.max(2, diffSeconds);
        }

        logger.warn(`parseRetryAfter(): Unknown data type for retryAfter: '${retryAfter}'`);
        return null;
    }

    // Organised by endpoint label
    const remoteLibrary = await ( async (relativePath) => {
        
        const configDir = fileURLToPath(new URL(relativePath, import.meta.url));

        let configFiles = readdirSync(configDir, { withFileTypes: true });

        configFiles = configFiles.filter(
            file => file.isFile() && !['pino', 'proxy'].some(prefix => file.name.startsWith(prefix)));

        const endpointMap = new Map();

        for (const file of configFiles) {

            const configFile = pathToFileURL(join(file.path, file.name)).href;

            const { default: remoteConfig } = await import(configFile);

            if (!remoteConfig?.endpoints || typeof remoteConfig.endpoints !== "object") {
                continue;
            }

            for (const [endpointName, endpoint] of Object.entries(remoteConfig.endpoints)) {

                // This is only necessary to support cases where the request rate is under 1/second
                const rateLimit = remoteConfig.rateLimit / remoteConfig.rollingWindow * 1000

                endpointMap.set(endpointName, {
                    host: remoteConfig.host,
                    port: remoteConfig.port,
                    protocol: remoteConfig.protocol,
                    headers: remoteConfig.headers,
                    rateLimit,
                    ...endpoint
                });
            }
        }

        logger.debug(`endpointMap created with ${endpointMap.size} entries`);

        return endpointMap;
    })("../conf/");

    const getEndpointDefs = (label, params) => {

        const endpoint = { ...remoteLibrary.get(label) };

        if (Object.keys(endpoint).length === 0) {
            logger.fatal(`APIManager() Endpoint label '${label}' doesn't exist`);
            process.exit(1);
        }

        Object.assign(endpoint, endpoint.build?.(params));
        return endpoint;
    }

    const requestStats = () => {

        const stats = serversIterator.next().value;

        if (stats) {

            const [server, obj] = stats;

            const now = Date.now();

            const paddedServer = server.padStart(paddingHostPort);
            const reqRate = (obj.count / ((now - obj.epoch) / 1000)).toFixed(2);

            obj.count = 0;
            obj.epoch = now;

            return {
                hostPort: paddedServer,
                reqRate
            };

        } else { // Defensive fallback. Execution should never reach this

            return {
                hostPort: 'n/a',
                reqRate: null
            };
        }
    }

    const acquireClearance = async (remoteStats, request) => {

        logger.trace('Reached the top of acquireClearance(). Request?', request);

        let clearance;

        if (request) {
            clearance = new Promise(resolve => {
                remoteStats.waitQueue.push(resolve);
            });
        }

        if (!remoteStats.leakTimeout) {

            remoteStats.waitQueue.shift()?.();

            remoteStats.leakTimeout = setTimeout(() => {

                remoteStats.leakTimeout = null;

                if (remoteStats.waitQueue.length > 0) {

                    logger.trace('About to recursively loop acquireClearance()');

                    acquireClearance(remoteStats, false); // false is just for clarity
                }
            /* +% to requestInterval could be a simple safeguard for rolling rate limiters. 
            This algo doesn't implement history - not stricly necessary because request rates 
            are calculated without history */
            }, remoteStats.requestInterval);

            logger.trace('Returning from null setTimeout at acquireClearance()');

            return;
        };

        logger.trace('Returning from active Promise at acquireClearance()');

        return clearance;
    };

    // Build the URL for each request
    const buildURL = (endpoint) => {

        const url = new URL("https://temporary.placeholder");
        url.protocol = endpoint.protocol;
        url.host = endpoint.host;
        url.port = endpoint.port;
        url.pathname = endpoint.pathname;

        for (const [key, value] of Object.entries(endpoint.searchParams ?? {})) {
            if (value !== undefined && value !== null) { url.searchParams.append(key, value); }
        }

        return url;
    };

    // Build the headers object for each request
    const buildHeaders = (endpoint) => {
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'APIPS/0.1.0'
        };

        Object.assign(headers, endpoint.headers);

        return headers;
    };

    // Fetch data from the remote API
    const fetchData = async (label, params = {}) => {
        
        const endpoint = getEndpointDefs(label, params);

        const hostPort = `${endpoint.host}:${endpoint.port}`;
        let remoteStats = requestCounts.get(hostPort);
        
        if (!remoteStats) {

            logger.debug(`Started tracking ${hostPort} stats`);

            remoteStats = { 
                count: 0, 
                epoch: Date.now(),
                waitQueue: [],
                leakTimeout: undefined,
                requestInterval: Math.ceil(1000 / endpoint.rateLimit), // in milliseconds
            }
            requestCounts.set(hostPort, remoteStats);

            paddingHostPort = Math.max(hostPort.length, paddingHostPort);
        }

        const url = buildURL(endpoint);
        logger.debug("URL:", url.href); // very useful for debugging

        const headers = buildHeaders(endpoint);
 
        // No HTTP error if body is undefined
        const body = endpoint.body && Object.keys(endpoint.body).length > 0
            ? JSON.stringify(endpoint.body)
            : undefined;

        let attempt = 0;
        while (true) {

            try {

                await acquireClearance(remoteStats, true);

                attempt++;
                remoteStats.count++;

                const response = await fetch(url, {
                    method: endpoint.method,
                    headers,
                    body,
                    signal: AbortSignal.timeout(15000)
                });

                if (response.status >= 200 && response.status < 300) {
                    
                    //return { headers: response.headers, request: await response.json() }; // for debugging
                    return response.json(); // current version expects JSON data only

                } else if (
                    response.status === 408 ||
                    response.status === 429 ||
                    response.status >= 500
                ) {
                    const delay =
                        parseRetryAfter(response.headers.get('retry-after')) ??
                        parseRetryAfter(response.headers.get('x-ratelimit-reset')) ?? // Envoy
                        backOffExp(attempt);

                    const error = Object.assign(new Error(`fetchData(): ${response.status} ${response.statusText}`),
                        {
                            name: 'ResponseError',      // Custom error class name
                            code: 'ERR_RESPONSE_RECOV', // Standard Node-style machine string
                            origin: url.origin,
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers
                        }
                    );

                    await retryPause(delay * 1000, attempt, `fetchData(): Retrying in ${delay} seconds`, error);
                    
                    continue;

                } else if (response.status === 404) {

                    const error = Object.assign(new Error(`fetchData(): ${response.status} ${response.statusText}`),
                        {
                            name: 'ResponseError',
                            code: 'ERR_RESPONSE_NOT_FOUND',
                            origin: url.origin,
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers,
                            url
                        }
                    );

                    logger.error({ error });

                    return null;

                } else {

                    const error = Object.assign(new Error(`fetchData(): ${response.status} ${response.statusText}`),
                        {
                            name: 'ResponseError',
                            code: 'ERR_RESPONSE_UNRECOV',
                            origin: url.origin,
                            status: response.status,
                            statusText: response.statusText,
                            response,
                            url
                        }
                    );

                    logger.fatal({ error });
                    process.exit(1);
                }
            
            } catch (error) {

                if (
                    error.name === 'TimeoutError' ||  // AbortSignal.timeout()
                    error.name === 'TypeError'    ||  // Network failure
                    
                    retryableNetworkCodes.has(error.code) ||
                    
                   (error instanceof SyntaxError &&
                    error.message.startsWith('Unexpected non-whitespace character after JSON'))
                ) { 

                    delay = backOffExp(attempt);

                    await retryPause(delay * 1000, attempt, `fetchData(): Retrying in ${delay} seconds`, error);

                    continue;
                
                } else {

                    logger.fatal({ error }, 'fetchData(): Unexpected or unrecoverable error');
                    process.exit(1);
                }
            }
        }
    }

    return { fetchData, requestStats };
};

export default APIManager;
