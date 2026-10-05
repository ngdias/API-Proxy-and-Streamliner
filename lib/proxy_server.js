/**
 * Class to instantiate a new HTTP proxy pass-through tunnel
 * 
 * @see https://nodejs.org/api/net.html#class-netsocket
 * Reference list of listeners and methods for connection sockets
 */

import net from 'net';
import http from 'http';

import proxyConf from './conf/proxy.js';
import Logger from './modules/logger.js';
import pinoServer from './conf/pino_server.js'
import { createRemoteLibrary, cyclicMapIterator } from './modules/utilities.js';

const logger = new Logger(pinoServer, 30);

HttpProxyTunnel(proxyConf);

async function HttpProxyTunnel(proxyConf = {}) {  

  const proxyServer = http.createServer((request, response) => {
    
    response.writeHead(405, { 'Content-Type': 'text/plain' });
    response.end('Only CONNECT requests are supported.');
  });

  const remoteLibrary = await createRemoteLibrary('../conf/', config => ({
    host: config.host,
    port: config.port,
    rateLimit: config.rateLimit,
    rollingWindow: config.rollingWindow
  }));

  logger.info(`remoteLibrary created with ${remoteLibrary.size} entries`);

  let statusInterval; // setInterval to display the status line. To be stopped at server shutdown
  const APIendpoints = new Map();

  let paddingHostPort = 0; // to align the status line

  const proxyHost = proxyConf.proxyHost ?? '127.0.0.1';
  const proxyPort = proxyConf.proxyPort ?? 3000;

  let queue = 0; // debug

  startProxy();
  reportStatus();

  async function handleConnect(request, clientSocket, head) {

    logger.debug(`Client requested CONNECT to ${request.url}`);

    const hostPortObj = validateRemoteEndpoint(request.url);

    if (!hostPortObj) {
      clientSocket.end(
        'HTTP/1.1 400 Bad Request\r\n' +
        'Content-Type: text/plain\r\n' +
        'Connection: close\r\n' +
        '\r\n' +
        'Invalid target endpoint authority. Expected host:port or [IPv6]:port.'
      );
      
      /*
       * Redundant, validateRemoteEndpoint() already produced detailed logging at this point
       * Can be used to tweak different levels of granularity with trace, debug, warn, etc.
      */
      //logger.warn(`Client requested invalid CONNECT authority: ${request.url}`);

      return;
    }
    
    const { hostname, port } = hostPortObj;
    const hostPort = `${hostname}:${port}`;

    const endpoint = ensureRemoteDefs(hostPort);

    if (!endpoint) {
      
      clientSocket.end(
        'HTTP/1.1 560 Unconfigured Endpoint\r\n' +
        'Content-Type: text/plain\r\n' +
        'Connection: close\r\n' +
        '\r\n' +
        `Remote endpoint ${hostPort} is not configured on this proxy.`
      );
      
      logger.warn(`Client requested ${hostPort}, but this remote destination is not configured on the proxy`);

      return;
    }

    logger.debug(`CONNECT request accepted for ${hostPort}`);

    let sequence = 0;

    clientSocket.on('data', async (chunk) => {

      sequence++;
      
      logger.trace({ chunkBytes: chunk.length, sequence }, 'New client request. Size:');

      logger.debug(`Received request for sequence #${sequence}`);

      await rateControl(endpoint, clientSocket, sequence);

      logger.debug(`Request ${sequence}: resumed`);
    });

    /* clientSocket was accepted by the HTTP server before handleConnect().
       These events are therefore normally already emitted at this point:
        - clientSocket.on('connect', ...)
        - clientSocket.on('ready', ...)
        - clientSocket.on('connectionAttempt', ...)
        - clientSocket.on('connectionAttemptFailed', ...)
        - clientSocket.on('connectionAttemptTimeout', ...)
        - clientSocket.on('lookup', ...)
    */

    clientSocket.on('drain', () => {
      logger.debug({ hostPort }, 'clientSocket drain');
    });

    clientSocket.on('timeout', () => {
      /* Placeholder if implementation is required
         It may need clientSocket.setTimeout(...) for triggering */ 
      logger.warn({ hostPort }, 'clientSocket timeout');
    });

    clientSocket.on('end', () => {
      logger.debug({ hostPort }, 'clientSocket received EOF');
    });

    clientSocket.on('close', (hadError) => { // callback argument is boolean
      logger.info(`Client socket closed. ${sequence} requests sent to ${hostPort} on this socket`);
      logger.debug({ hostPort, hadError }, 'clientSocket closed');
    });

    clientSocket.on('error', (error) => {
      logger.error({ hostPort, error }, 'clientSocket');
    });

    let targetSocket;
    try {
      targetSocket = net.connect(port, hostname, () => {

        logger.info(`Connected to remote endpoint authority ${hostPort}`);

        clientSocket.write(
          'HTTP/1.1 200 Connection Established\r\n' +
          'Proxy-agent: Node-Proxy\r\n' +
          '\r\n');

        targetSocket.write(head);
        targetSocket.pipe(clientSocket);
        clientSocket.pipe(targetSocket);
      });

    } catch (error) { // For synchronous failures from net.connect()

      logger.error({ error }, `targetSocket for ${hostPort} failed to connect`);
      clientSocket.destroy();
      return;
    }

    targetSocket.on('connectionAttempt', (ip, port, family) => {
      logger.debug({ hostPort, ip, port, family }, 'targetSocket connection attempt');
    });

    targetSocket.on('connectionAttemptFailed', (ip, port, family, error) => {
      logger.error({ hostPort, ip, port, family, error}, 
        'targetSocket - connection attempt failed');
    });

    targetSocket.on('connectionAttemptTimeout', (ip, port, family) => {
      logger.warn({ hostPort, ip, port, family}, 
        'targetSocket - connection attempt timed out');
    });

    targetSocket.on('lookup', (error, address, family, host) => {
      if (error) {
        logger.error({error, hostPort, address, family, host}, 'targetSocket lookup error');

      } else {
        logger.debug({hostPort, address, family, host}, 'targetSocket lookup');
      }
    });

    targetSocket.on('connect', () => {
      logger.debug({ hostPort }, 'targetSocket connected');
    });

    targetSocket.on('ready', () => {
      logger.debug({ hostPort }, 'targetSocket ready');
    });

    targetSocket.on('drain', () => {
      logger.debug({ hostPort }, 'targetSocket drain');
    });

    targetSocket.on('timeout', () => {
      // It may need targetSocket.setTimeout(...) for triggering
      logger.warn({ hostPort }, 'targetSocket timeout');
    });

    targetSocket.on('end', () => {
      logger.debug({ hostPort }, 'targetSocket received EOF');
    });

    targetSocket.on('close', (hadError) => { // callback argument is boolean
      logger.debug({ hostPort, hadError }, 'targetSocket closed.');
    });

    targetSocket.on('error', (error) => {
      logger.error({ hostPort, error }, 'targetSocket');
    });
  };

  function validateRemoteEndpoint(server) {

    if (typeof server !== 'string' || server.length === 0) {
      logger.warn("Client requested invalid remote host:port authority. Must be a non-empty string");
      return null;
    }

    let hostname;
    let port;

    if (server.startsWith('[')) { // IPv6 ex. [2001:db8::1]:443

      const closingBracket = server.indexOf(']');

      if (closingBracket === -1) {
        logger.warn(`Client requested invalid IPv6 remote host:port authority. Missing closing bracket: ${server}`);
        return null;
      }

      hostname = server.slice(1, closingBracket);

      if (server[closingBracket + 1] !== ':') {
        logger.warn(`Client requested invalid IPv6 remote host:port authority. Missing port separator: ${server}`);
        return null;
      }

      port = server.slice(closingBracket + 2);

    } else { // Hostname or IPv4: ex. api.gbif.org:443 / 192.0.2.10:443

      const separator = server.lastIndexOf(':');

      if (separator === -1) {
        logger.warn(`Client requested invalid IPv4 remote host:port authority. Missing port separator: ${server}`);
        return null;
      }

      hostname = server.slice(0, separator);
      port = server.slice(separator + 1);
    }

    if (!hostname) {
      logger.warn(`Client requested invalid remote host:port authority. Missing host name`);
      return null;
    }

    if (!port) {
      logger.warn(`Client requested invalid remote host:port authority. Missing port`);
      return null;
    }

    if (!/^\d+$/.test(port)) {
      logger.warn(`Client requested invalid remote host:port authority. Port must be an integer`);
      return null;
    }

    port = Number(port);

    if (port < 1 || port > 65535) {
      logger.warn(`Client requested invalid remote host:port authority. Port must be between 1 and 65535`);
      return null;
    }

    return { hostname, port };
  };

  function printProxyStatus() {

    if (proxyServer.listening) {
      logger.info(`HTTP pass-through proxy server listening on ${proxyHost}:\x1b[33m${proxyPort}\x1b[0m`);

    } else {
      logger.info("HTTP pass-through proxy server closed");
    }
  };

  function ensureRemoteDefs(hostPort) {

    let endpoint = APIendpoints.get(hostPort);

    if (!endpoint) {

      const remoteConf = remoteLibrary.get(hostPort);

      if (!remoteConf) return null; //reject unknown remote

      endpoint = {
        ...remoteConf,
        requestInterval: Math.ceil(1000 / remoteConf.rateLimit), // units in milliseconds
        requestsEpochs: [],
      };

      APIendpoints.set(hostPort, endpoint);
      paddingHostPort = Math.max(hostPort.length, paddingHostPort);
    }

    return endpoint;
  }

  async function rateControl(endpoint, clientSocket, sequence) {

    const now = Date.now();

    const cutoff = now - endpoint.rollingWindow;

    const thresholdIndex = endpoint.requestsEpochs.findIndex(t => t >= cutoff);

    const requestHistory = thresholdIndex === -1 ? [] : endpoint.requestsEpochs.slice(thresholdIndex); // trim into a shallow copy

    const startIndex = requestHistory.length - Math.ceil(endpoint.rateLimit * endpoint.rollingWindow / 1000);

    // Timestamp of the request sent at the start of the rolling window 
    const startWindow = requestHistory[startIndex]; // ? endpoint.requestsEpochs[startIndex] : endpoint.requestsEpochs.at(-1);

    const earliestAllowed = startWindow ? startWindow + endpoint.rollingWindow + 50 : now; // +50 is protection against network jitter and Node.js lag

    // Stack relative to either now or previous scheduled slots 
    const lastScheduled = requestHistory.at(-1); 
    const baseTime = lastScheduled ? Math.max(now, lastScheduled + Math.ceil(endpoint.rollingWindow / endpoint.rateLimit) * 1.05) : now; // 1.05 - same as above

    const scheduledTime = Math.max(baseTime, earliestAllowed);

    endpoint.requestsEpochs.push(scheduledTime);

    const waitMs = scheduledTime - now;

    // Delay only if scheduled in the future
    if (waitMs > 0) { 
      
      queue++;
      logger.warn("Queue length:", queue);

      logger.debug("Pausing request #", sequence);
      clientSocket.pause();

      return new Promise(resolve => setTimeout(() => {

        clientSocket.resume();
        logger.debug("Resuming request #", sequence);
        queue--;
        resolve();

      }, waitMs))
    
    } else {

      logger.debug("Request #", sequence, "proceeded immediately");
    }
  };

  function reportStatus() { // print the status line in the console iterating over all initiated remote destinations

    const endpointIterator = cyclicMapIterator(APIendpoints);

    statusInterval = setInterval(() => {

      const result = endpointIterator.next().value;

      if (result === null) {
        logger.status('«--» No initiated endpoints «--»');
        return;
      }

      const [hostPort, params] = result;

      const pollingInterval = Math.max(params.rollingWindow, 10000);

      const now = Date.now();

      const cutoff = now - pollingInterval;

      while (params.requestsEpochs[0] < cutoff) {
          params.requestsEpochs.shift(); // trim in place
      }

      const futureIndex = params.requestsEpochs.findIndex(epoch => epoch > now);

      const requestCount = futureIndex === -1 ? params.requestsEpochs.length : futureIndex;

      const rollingRequestRate = requestCount / (pollingInterval / 1000);

      let rateDisplay;

      if (rollingRequestRate < 0.1 && rollingRequestRate > 0) {
        const reqPerMin = rollingRequestRate * 60;
        rateDisplay = `${reqPerMin.toFixed(2)} req/min`;

      } else {
        rateDisplay = `${rollingRequestRate.toFixed(2)} req/sec`;
      }

      logger.status(
        `«--» ${hostPort.padStart(paddingHostPort)} | Request rate: ` +
        `\x1b[33m${rateDisplay}\x1b[0m «--»`
      );
    }, 3000);
  };

  function startProxy() {

    proxyServer.on('connect', handleConnect.bind(this));

    proxyServer.on('close', () => {
      printProxyStatus();
    });

    proxyServer.on('timeout', (socket) => {

      logger.warn({
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localAddress: socket.localAddress,
        localPort: socket.localPort,
        bytesRead: socket.bytesRead,
        bytesWritten: socket.bytesWritten
        }, 'Proxy client socket timeout');
    });

    proxyServer.on('error', (error) => {

      if (error.code === 'EADDRINUSE') {
        logger.fatal(`Local port ${error.port} already in use`);
        process.exit(1);

      } else if (error.code === 'EACCES') {
        logger.fatal(`Permission denied while binding to local port ${proxyPort}`);
        process.exit(1);

      } else if (error.code === 'EADDRNOTAVAIL') {
        logger.fatal(`Local address ${proxyHost} is not available`);
        process.exit(1);
      }
 
      logger.error({ error: error }, 'Unexpected proxy server error');
    });

    proxyServer.listen(proxyPort, proxyHost, () => {
      
      printProxyStatus();
    });
  };

  function stopProxy() {

    if (proxyServer.listening) {
      proxyServer.close();
    }
    clearInterval(statusInterval);
  };

  return { printProxyStatus, stopProxy }
};
