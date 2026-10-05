/**
 * Logging module
 * 
 * - Logs to a rotating log file via Pino
 * 
 * - Logs to console with a custom persistent status line / dashboard line 
 *   at the bottom of the terminal
*/

import util from 'node:util';
import { Console } from 'node:console';

// ANSI color codes
const c = {
    trace: '\x1b[2m',    // dim
  //debug: '\x1b[90m',   // bright black or gray
    debug: '\x1b[2m',    // dim
    log:   '',           // default white
    info:  '\x1b[36m',   // cyan
    warn:  '\x1b[33m',   // yellow
    error: '\x1b[31m',   // red
    fatal: '\x1b[1;91m', // bright red + bold
    reset: '\x1b[0m'     // reset
};

const levels = {
    trace: { verb: 10, l: ' TRACE ', c: c.trace },
    debug: { verb: 20, l: ' DEBUG ', c: c.debug },
    log:   { verb: 30, l: ' LOG   ', c: c.log },
    info:  { verb: 30, l: ' INFO  ', c: c.info },
    warn:  { verb: 40, l: ' WARN  ', c: c.warn },
    error: { verb: 50, l: ' ERROR ', c: c.error },
    fatal: { verb: 60, l: ' FATAL ', c: c.fatal }
};

// Comment out .slice(0, 19).replace('T', ' '); if you need millisecond resolution
const timestamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

class DualLogger extends Console {

    #status = '';
    #defaultVerb = 30;

    constructor(pinoLogger, verbosity) {
        super(process.stdout, process.stderr);
        this.logger = pinoLogger;
        this.consoleVerbosity = verbosity ?? this.#defaultVerb;
    }

    trace(...args) {
        this.logger.trace(...args);
        this.#printLog(levels.trace, ...args);
    }

    debug(...args) {
        this.logger.debug(...args);
        this.#printLog(levels.debug, ...args);
    }

    info(...args) {
        this.logger.info(...args);
        this.#printLog(levels.info, ...args);
    }

    log(...args) {
        this.logger.info(...args);
        this.#printLog(levels.log, ...args);
    }

    warn(...args) {
        this.logger.warn(...args);
        this.#printLog(levels.warn, ...args);
    }

    error(...args) {
        this.logger.error(...args);
        this.#printLog(levels.error, ...args);
    }

    fatal(...args) {
        this.logger.fatal(...args);
        this.#printLog(levels.fatal, ...args);
    }

    status(message) {
        this.#clearStatus();
        this.#status = message;
        this.#printStatus();
    }

    #clearStatus() {
        if (!this.#status) return;
        process.stdout.write('\r\x1b[2K');
    }

    #printLog(level, ...args) {

        if (this.consoleVerbosity <= level.verb) {

            let data;
            let message;
            const [first, ...rest] = args;

            if (typeof first === 'object' && first !== null) {
                message = rest.join(' ');
                data = util.inspect(first, { breakLength: Infinity, compact: true });
            
            } else {
                message = args.join(' ');
                data = null;
            }

            const output = data ? `${message} ${data}` : message;

            this.#clearStatus();

            super.log(`${timestamp() + level.c + level.l}%s${c.reset}`, message);

            if (data) super.log(`${timestamp() + level.c + level.l}%s${c.reset}`, data);
            
            this.#printStatus();
        }
    }

    #printStatus() {
        if (!this.#status) return;
        process.stdout.write(`\r${this.#status}`);
    }
}

export default DualLogger;