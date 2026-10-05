/**
 * Pino configuration file, proxy server settings
 * 
 * Default Levels:
 * 
 * 10: trace
 * 20: debug
 * 30: info
 * 40: warn
 * 50: error
 * 60: fatal
 * 
 * @see https://npm.io/package/pino
 * @see https://npm.io/package/pino-roll
 * @see https://github.com/pinojs/pino-pretty
*/

import pino from 'pino';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pinoLogger = pino(
    {
        level: 'info'
    },
    pino.transport({
        target: 'pino-roll',
        options: {
            file: path.resolve(__dirname, '../../logs/server.log'),
            frequency: 'daily',
            size: '10m',
            mkdir: true
        }
    })
);

export default pinoLogger;

