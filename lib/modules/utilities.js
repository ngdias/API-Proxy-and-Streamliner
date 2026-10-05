/**
 * Module containing shared objects and functions
*/

import { join } from "node:path";
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Usage template:
 * 
 * const {GITHUB_KEY, OA_API_KEY} = validateKeys({
 *   GITHUB_KEY: {value: '123', validator: value => value.startsWith('github_pat_')},
 *   OA_API_KEY: {value: '456', validator: value => /^[A-Za-z0-9]+$/.test(value)},
 * });
 */
export const validateKeys = (schema) => {

  const errors = [];
  const keys = {};

  for (const [name, data] of Object.entries(schema)) {

    const value = data.value;

    if (value === undefined || value === '') {
        errors.push(`${name} is missing the value`);
        continue;
    }

    if (!data.validator(value)) {
        errors.push(`${name}: invalid format`);
        continue;
    }

    keys[name] = value;
  }

  if (errors.length > 0) {
    throw new Error(`Environment configuration is invalid:\n- ${errors.join('\n- ')}`);
  }

  return keys;
}

// Organised by authority
export const createRemoteLibrary = async (relativePath, payloadFn) => {
    
    const configDir = fileURLToPath(new URL(relativePath, import.meta.url));

    let configFiles = readdirSync(configDir, { withFileTypes: true });

    configFiles = configFiles.filter(
      file => file.isFile() && !['pino', 'proxy'].some(prefix => file.name.startsWith(prefix)));

    const remoteLibrary = new Map();

    for (const file of configFiles) {

        const configFile = pathToFileURL(join(configDir, file.name)).href;

        const { default: remoteConfig } = await import(configFile);

        const hostPort = `${remoteConfig.host}:${remoteConfig.port}`;

        remoteLibrary.set(hostPort, payloadFn(remoteConfig));
    }

    return remoteLibrary;
}

export function* cyclicMapIterator(map) {

  while (true) {

    if (map.size === 0) {
      yield null; // Pauses here. Next call will check map.size again.

    } else {
      yield* map.entries();
    }
  }
}

/* More granular / strict retry rules for some of these
   codes may be warranted in specific situations. */
export const retryableNetworkCodes = new Set([
  // Connection
  'ECONNABORTED',  // Connection aborted
  'ECONNREFUSED',  // Proxy or remote endpoint refused connection
  'ECONNRESET',    // Connection reset
  'EPIPE',         // Write to a closed socket

  // Network
  'EAI_AGAIN',     // Temporary DNS resolution failure
  'ENETDOWN',      // Network interface/network unavailable
  'ENETUNREACH',   // Network unreachable
  'EHOSTUNREACH',  // Host unreachable

  // Timeout
  'ETIMEDOUT'      // Operation timed out
]);