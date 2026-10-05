/**
 * Module that builds API URLs, sends requests, applies retries, 
 * and returns parsed JSON. Implementation for proxy usage.
*/

import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ProxyTunnelClient from './agent_request.js';
import { cyclicMapIterator, retryableNetworkCodes } from './utilities.js';

const APIManager = async (logger) => {

    let delay;
    const MAX_ATTEMPTS = 50;
    let paddingHostPort = 0; // to align the status line
    const getResponse = await ProxyTunnelClient(logger);

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

    /** Expects a date or time in seconds */
    const parseRetryAfter = (retryAfter) => {

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
            
                endpointMap.set(endpointName, {
                    host: remoteConfig.host,
                    port: remoteConfig.port,
                    protocol: remoteConfig.protocol,
                    headers: remoteConfig.headers,
                    ...endpoint
                });
            }
        }

        logger.debug(`endpointMap created with ${endpointMap.size} entries`)

        return endpointMap;
    })("../conf/");

    const getEndpointDefs = (label, params) => {
        const endpoint = { ...remoteLibrary.get(label) };

        if (Object.keys(endpoint).length === 0) {
            logger.fatal(`APIManager() Endpoint label '${label}' doesn't exist`)
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

    // Build the URL for each request
    const buildURL = (endpoint) => {

        const url = new URL("https://temporary.placeholder");
        url.protocol = endpoint.protocol;
        url.host = endpoint.host;
        url.port = endpoint.port;
        url.pathname = endpoint.pathname;

        for (const [key, value] of Object.entries(endpoint.searchParams ?? {})) {
            if (value !== undefined && value !== null) url.searchParams.append(key, value);
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

    // Fetch the data from the API
    const fetchData = async (label, params = {}) => {
        
        const endpoint = getEndpointDefs(label, params);

        const hostPort = `${endpoint.host}:${endpoint.port}`;
        let remoteStats = requestCounts.get(hostPort);
        
        if (!remoteStats) {

            logger.debug(`Added new ${hostPort} server to remoteStats`);

            remoteStats = { count: 0, epoch: Date.now() }
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

        const options = {
            method: endpoint.method,
            headers
        }

        let attempt = 0;
        while (true) {

            try {
                attempt++;

                const response = await getResponse(url, options, body);
                remoteStats.count++;

                if (response.statusCode >= 200 && response.statusCode < 300) {
                    
                    //return { headers: response.headers, request: JSON.parse(response.body) }; // for debugging
                    return JSON.parse(response.body); // current version expects JSON data only

                } else if (
                    response.statusCode === 408 ||
                    response.statusCode === 429 ||
                    response.statusCode >=  500
                ) {
                    const delay =
                        parseRetryAfter(response.headers['retry-after']) ??
                        parseRetryAfter(response.headers['x-ratelimit-reset']) ?? // e.g. Envoy
                        backOffExp(attempt);

                    const error = Object.assign(new Error(`fetchData(): ${response.statusCode} ${response.statusMessage}`),
                        {
                            name: 'ResponseError',      // Custom error class name
                            code: 'ERR_RESPONSE_RECOV', // Standard Node-style machine string
                            origin: url.origin,
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            headers: response.headers
                        }
                    );

                    await retryPause(delay * 1000, attempt, `fetchData(): Retrying in ${delay} seconds`, error);
                    
                    continue;

                } else if (response.statusCode === 404) {

                    const error = Object.assign(new Error(`fetchData(): ${response.statusCode} ${response.statusMessage}`),
                        {
                            name: 'ResponseError',
                            code: 'ERR_RESPONSE_NOT_FOUND',
                            origin: url.origin,
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            headers: response.headers,
                            url
                        }
                    );

                    logger.error({ error });

                    return null;

                } else {

                    const error = Object.assign(new Error(`fetchData(): ${response.statusCode} ${response.statusMessage}`),
                        {
                            name: 'ResponseError',
                            code: 'ERR_RESPONSE_UNRECOV',
                            origin: url.origin,
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            headers: response.headers,
                            url
                        }
                    );

                    logger.fatal({ error });
                    process.exit(1);
                }
            
            } catch (error) {

                if (
                    error.name === 'AbortError'   ||  // Timeout
                    error.name === 'TypeError'    ||  // Network failure
                    error.name === 'AgentError'   ||  // Custom CreateAgent() error
                    error.name === 'RequestError' ||  // Custom getResponse() error
            
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
