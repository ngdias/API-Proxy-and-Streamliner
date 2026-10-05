/**
 * Module that creates Agents and sends HTTPS get requests
*/

import http from 'http';
import https from 'https';

import proxyConf from '../conf/proxy.js';
import { createRemoteLibrary, retryableNetworkCodes } from './utilities.js';

const ProxyTunnelClient = async (logger) => {
    
    let nextAgentId = 1;
    let requestSocket = null;

    let httpsRequests = 0; // For debugging; reports the number of completed requests per Agent session
    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

    const remoteLibrary = await createRemoteLibrary('../conf/', config => ({
        host: config.host,
        port: config.port,
        agent: null,
        agentSocket: null
    }));

    const ensureAgent = async (url) => {

        let port = parseInt(url.port, 10);

        if (isNaN(port)) port = url.protocol === 'https:' ? 443 : 80;

        const hostPort = `${url.hostname}:${port}`;

        const tunnelSettings = remoteLibrary.get(hostPort);

        // Deduplication lock: if an Agent creation process is in-flight, latch onto its Promise
        if (tunnelSettings.agent && typeof tunnelSettings.agent.then === 'function') {

            logger.debug(`ensureAgent(): Concurrently waiting on Agent creation for: ${hostPort}`);
            await tunnelSettings.agent; 
        }

        const currentAgent = tunnelSettings.agent;

        if (currentAgent &&
            !currentAgent.destroyed &&
            tunnelSettings.agentSocket &&
            !tunnelSettings.agentSocket.destroyed &&
            tunnelSettings.agentSocket.readyState === 'open'
        ) { 
            logger.debug("ensureAgent(): A valid Agent already exists");
            return tunnelSettings; // Concurrent requests also exit here
        }
        
        // Executes if an existing Agent failed the health check directly above
        if (currentAgent && typeof currentAgent.destroy === 'function') {

            /* Destroy any queued requests within the invalid Agent
               trigger an error to be caught by the upstream retry logic */
            for (const requests of Object.values(currentAgent.requests || {})) {

                if (!Array.isArray(requests)) continue;

                for (const request of requests) {

                    if (!request.destroyed) {

                        const error = Object.assign(new Error(`agentRequest(): socket closed, queued request destroyed`),
                            {
                                name: 'AgentError',                // Custom error class name
                                code: 'ERR_AGENT_SOCKET_CLOSED',   // Standard Node-style machine string
                                hostPort,
                                requestPath: request.path,
                                requestDestroyed: request.destroyed,
                                socketDestroyed: tunnelSettings.agentSocket?.destroyed,
                                socketReadyState: tunnelSettings.agentSocket?.readyState
                            }
                        );

                        logger.debug({ requestPath: request.path }, 
                            'ensureAgent(): Agent invalidated, destroying queued request');

                        request.destroy(error);
                    }
                }
            }

            currentAgent.destroy();
        }

        logger.debug("ensureAgent(): entering createAgent() now");

        // Synchronously create and assign the promise to intercept asynchronous bursts
        const creationPromise = createAgent(hostPort);
        tunnelSettings.agent = creationPromise;

        /* Wait for completion and swap the fulfilled promise for the actual functional agent object during  
           the same microtask execution order - before any waiting async requests get a chance to proceed */
        const freshAgent = await creationPromise;
        tunnelSettings.agent = freshAgent;

        return tunnelSettings;
    }

    async function createAgent(hostPort) {

        return new Promise((resolve, reject) => {

            const tunnelSettings = remoteLibrary.get(hostPort);

            const agentRequest = http.request({
                host: proxyConf.proxyHost, // IP address of proxy server
                port: proxyConf.proxyPort, // port of proxy server
                method: 'CONNECT',
                path: hostPort,  // must include port!
                timeout: 10000,
                headers: { // Placeholder
                    //'Proxy-Authorization': auth
                },
            })
            .on('connect', async (response, socket) => {

                if (response.statusCode === 200) { // Connected to proxy server

                    logger.info(`createAgent() request OK for ${hostPort}`);

                    tunnelSettings.agentSocket = socket;

                    const newAgent = new https.Agent({ 
                        socket: socket, 
                        keepAlive: true,         // Enable keep-alive connections
                        maxSockets: 1,           // Maximum number of sockets to allow per host
                        maxTotalSockets: 1,      // If the agent may serve more than one target origin; maxSockets alone is per origin.
                        maxFreeSockets: 1,       // Maximum number of sockets per host to leave open in a free state
                        //keepAliveMsecs: 5000,  // Specifies the initial delay for TCP Keep-Alive packets
                        //scheduling: 'lifo'     // Good for low/moderate, intermittent traffic: it tends to reuse the freshest socket and reduces reuse of stale idle connections.
                        //timeout: 40000,        // Socket timeout in milliseconds. Affects the socket close event emitter only when active
                        //maxCachedSessions: 1   // TLS session caching is usually beneficial; tune only after measuring memory/handshake behavior.
                    });

                    newAgent.agentUUID = crypto.randomUUID();
                    logger.debug("createAgent(): New agent UUID:", newAgent.agentUUID);

                    socket.setKeepAlive(true); // doesn't seem to matter in this use case
                    socket.setTimeout(25000);  // affects socket timeout event emitter
                    
                    socket.once('close', (hadError) => {

                        logger.warn({
                            hadError,
                            socketDestroyed: socket.destroyed,
                            socketReadyState: socket.readyState
                        }, "createAgent() tunnel socket closed");
                        
                        /* Destroy any queued requests within the now invalid Agent
                           trigger an error to be caught by the upstream retry logic */
                        for (const requests of Object.values(newAgent.requests || {})) {

                            if (!Array.isArray(requests)) continue;

                            for (const request of requests) {

                                if (!request.destroyed) {

                                    const error = Object.assign(new Error(`agentRequest(): socket closed`),
                                        {
                                            name: 'AgentError',              // Custom error class name
                                            code: 'ERR_AGENT_SOCKET_CLOSED', // Standard Node-style machine string
                                            hostPort,
                                            agentUUID: newAgent.agentUUID,   // Custom Agent identifier
                                            requestPath: request.path,
                                            requestDestroyed: request.destroyed,
                                            socketDestroyed: socket.destroyed,
                                            socketReadyState: socket.readyState
                                        }
                                    );

                                    logger.warn({ agentUUID: newAgent.agentUUID, requestPath: request.path }, 
                                        'createAgent(): socket closed, destroying request in Agent queue');

                                    request.destroy(error);
                                }
                            }
                        }

                        //socket.removeAllListeners(); // Current usage and testing have not shown a need for this

                        newAgent.destroy();
                    });
                    
                    socket.once('end', () => {
                        logger.debug('createAgent(): tunnel socket ended');
                        socket.destroy();
                    });

                    socket.on('timeout', () => {
                        logger.debug({
                            destroyed: socket.destroyed,
                            readyState: socket.readyState
                        }, "createAgent(): tunnel socket timeout");
                    });

                    socket.on('error', (error) => {
                        logger.error({ error }, "createAgent(): tunnel socket error");
                    });

                    resolve(newAgent);

                } else {

                    if ([408, 429, 500, 502, 503, 504].includes(response.statusCode)) {

                        const error = Object.assign(new Error(`agentRequest(): Cannot establish Agent connection to remote server`),
                            {
                                name: 'AgentError',            // Custom error class name
                                code: 'ERR_CONNECT_REJECTED',  // Standard Node-style machine string
                                hostPort,
                                statusCode: response.statusCode, 
                                statusMessage: response.statusMessage
                            }
                        );

                        socket.destroy();
                        agentRequest.destroy();
                        tunnelSettings.agent = null;
                        reject(error);

                    } else {

                        const error = Object.assign(new Error('Cannot establish Agent connection to remote server'),
                            {
                                name: 'AgentError',            // Custom error class name
                                code: 'ERR_CONNECT_REJECTED',  // Standard Node-style machine string
                                hostPort,
                                statusCode: response.statusCode, 
                                statusMessage: response.statusMessage
                            }
                        );

                        logger.fatal({ error }, 'agentRequest(): Unrecoverable response error while creating Agent. Giving up.');
                        process.exit(1);
                    }
                }
            })
            .on('timeout', () => {

                logger.warn("createAgent(): Connection request timeout");

                const error = Object.assign(new Error('createAgent() CONNECT timeout'),
                    {
                        name: 'AgentError',            // Custom error class name
                        code: 'ERR_CONNECT_TIMEOUT',   // Standard Node-style machine string
                        hostPort
                    }
                );

                agentRequest.destroy(error);
            })
            .on('error', async (error) => {

                const errorCode = typeof error?.code === 'string' ? error.code : '';

                if (retryableNetworkCodes.has(errorCode)) {
                    
                    logger.warn("createAgent(): Retryable network error");
                    agentRequest.destroy();
                    tunnelSettings.agent = null;
                    reject(error);

                } else if (['ERR_CONNECT_REJECTED', 'ERR_CONNECT_TIMEOUT'].includes(errorCode)) {

                    logger.warn("createAgent(): Retryable connection error");
                    tunnelSettings.agent = null;
                    reject(error);

                } else {
                    logger.fatal({ error }, "createAgent(): Unexpected request error");
                    process.exit(1);
                }
            })
            .end();
        })
    };

    async function getResponse(url, options, body) {

        const tunnelSettings = await ensureAgent(url);

        const agent = tunnelSettings.agent;

        Object.assign(options, { agent, timeout: 15000 });

        return new Promise((resolve, reject) => {

            /**
             * Node's https.request() does not have a body parameter
             * 
             * @see https://nodejs.org/api/http.html#class-httpclientrequest
             * @see https://nodejs.org/api/http.html#httprequesturl-options-callback
            */
            const request = https.request(url, options, response => {

                let chunks = [];
                let bytesReceived = 0;

                response.on('data', (chunk) => {
                    
                    bytesReceived += chunk.length;

                    if (bytesReceived > MAX_RESPONSE_BYTES) {

                        const error = Object.assign(new Error(`getResponse(): response exceeds ${MAX_RESPONSE_BYTES} bytes`),
                            {
                                name: 'RequestError',          // Custom error class name
                                code: 'ERR_RESPONSE_TOO_LARGE' // Standard Node-style machine string
                            }
                        );

                        response.destroy(error);
                        return; // Interrupt the data stream; the response 'error' listener rejects the Promise
                    }

                    chunks.push(chunk);
                });
                
                response.once('end', () => {

                    if (!response.complete) {

                        const error = Object.assign(new Error('getResponse(): response ended before the HTTP message completed'),
                            {
                                name: 'RequestError',
                                code: 'ERR_RESPONSE_INCOMPLETE'
                            }
                        );
                        
                        return reject(error);
                    }

                    httpsRequests++;

                    resolve({ 
                        body: Buffer.concat(chunks).toString('utf8'),
                        headers: response.headers,
                        statusCode: response.statusCode,
                        statusMessage: response.statusMessage
                    });
                });

                response.once('close', () => {
                    
                    if (response.errored?.code === 'ERR_RESPONSE_TOO_LARGE') {
                        return; // intentional local size-limit shutdown
                    
                    } else if (!response.complete) {

                        const error = Object.assign(new Error('getResponse(): response closed before completion'),
                            {
                                name: 'RequestError',
                                code: 'ERR_RESPONSE_CLOSED_EARLY'
                            }
                        );
                        
                        logger.error({ error, statusCode: response.statusCode },
                            'getResponse(): Response closed early');

                        return reject(error);
                    }

                    logger.debug("Bytes received:", bytesReceived);
                    logger.debug("getResponse(): Response close");
                });

                response.once('timeout', () => {
                    /* Placeholder if implementation is required
                    response is an IncomingMessage stream
                    It may need response.setTimeout(...); for triggering or if
                    the underlying socket’s timeout produces activity that reaches it
                    The request timeout is the one that normally matters, so
                    this is probably redundant. Also it may never fire.*/ 
                    logger.warn("getResponse(): response timeout");
                });

                response.once('error', (error) => {
                    
                    logger.error({ error }, "getResponse(): Response error");
                    reject(error);
                });
            })
            .once('socket', socket => {

                logger.trace({
                    agentUUID: tunnelSettings.agent.agentUUID,
                    socketIsNull: socket === null,
                    socketIsUndefined: socket === undefined,
                    socketType: socket?.constructor?.name,
                    reusedSocket: request.reusedSocket,
                    destroyed: socket?.destroyed,
                    readyState: socket?.readyState,

                    listeners: Object.fromEntries(
                        ['error', 'end', 'close', 'connect', 'data'].map(event => [
                            event,
                            socket.listenerCount(event)
                        ])
                    )
                }, 'getResponse(): socket info');
            })
            .once('close', () => {

                if (tunnelSettings.agentSocket?.readyState !== 'open') {
                    
                    logger.debug('getResponse(): closed with Agent socket not open');
                    logger.debug(`Total number of HTTPS requests completed: ${httpsRequests}`);

                } else {

                    logger.trace("getResponse(): closed, agentSocket readyState:", tunnelSettings.agentSocket?.readyState);
                    logger.debug("getResponse(): closed");
                }

            })
            .once('timeout', () => { // request timeout value defined in the options object

                logger.warn("getResponse(): timeout");

                const error = Object.assign(new Error('getResponse() timeout'),
                    {
                        name: 'AbortError',
                        code: 'ERR_REQUEST_TIMEOUT'
                    }
                );

                request.destroy(error);
            })
            .once('error', (error) => { 

                if (error.name === 'AgentError') {
                    
                    logger.debug("getResponse(): AgentError", error.code, error.agentUUID);
                    reject(error);

                } else if (
                    ['AbortError', 'RequestError'].includes(error.name) ||
                    retryableNetworkCodes.has(error.code)
                ) {
                    reject(error);

                } else {
                    logger.error('getResponse(): Unforseen error');
                    reject(error);
                }
            })
            .end(body);
        })
    };

    return getResponse;
}

export default ProxyTunnelClient;