// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const argv = require('minimist')(process.argv.slice(2));
const fs = require('fs');
const metrics = require('./metrics.js');
const path = require('path');
const { serverConfig } = require('./server_config.js');
const { inspect } = require('util');
const winston = require('winston');
const { format } = winston;
const Transport = require('winston-transport');

let dumpToFile = false;
let log_dir = './logs/';
let last_uid = 0;
let pid = process.pid;
let logger = {};
let raw_console = {};
if (pid === 1 && process.env.PODNAME) {
  pid = process.env.PODNAME;
  let split = pid.split('-');
  if (split.length > 2) {
    pid = `${split[0][0]}${split.pop()}`;
  }
  console.log(`Using fake logging PID of ${pid}`);
}

const LOG_LEVELS = {
  debug: 4,
  log: 3,
  info: 2,
  warn: 1,
  error: 0,
};

export function getUID() {
  return ++last_uid;
}

export function dumpJSON(prefix, data, ext) {
  if (dumpToFile) {
    let filename = path.join(log_dir, `${prefix}-${pid}-${++last_uid}.${ext || 'log'}`);
    fs.writeFile(filename, JSON.stringify(data), function (err) {
      if (err) {
        console.error(`Error writing to log file ${filename}`, err);
      }
    });
    return filename;
  } else {
    let crash_id = `${prefix}-${++last_uid}`;
    logger.log('error', crash_id, data);
    return `GKE:${crash_id}`;
  }
}

export function debug(message, ...args) {
  metrics.add('log.debug', 1);
  logger.log('debug', message, args.length === 0 ? null : (args.length === 1 ? args[0] : args));
}

export function info(message, ...args) {
  metrics.add('log.info', 1);
  logger.log('info', message, args.length === 0 ? null : (args.length === 1 ? args[0] : args));
}

export function warn(message, ...args) {
  metrics.add('log.warn', 1);
  logger.log('warn', message, args.length === 0 ? null : (args.length === 1 ? args[0] : args));
}

export function error(message, ...args) {
  metrics.add('log.error', 1);
  logger.log('error', message, args.length === 0 ? null : (args.length === 1 ? args[0] : args));
}

function argProcessor(arg) {
  if (typeof arg === 'object') {
    return inspect(arg, { breakLength: Infinity });
  }
  return arg;
}

const { MESSAGE, LEVEL } = require('triple-beam');

class SimpleConsoleTransport extends Transport {
  log(linfo, callback) {
    raw_console[linfo[LEVEL]](linfo[MESSAGE]);

    if (callback) {
      callback();
    }
    this.emit('logged', linfo);
  }
}

const STACKDRIVER_SEVERITY = {
  silly: 'DEFAULT',
  verbose: 'DEBUG',
  debug: 'DEBUG',
  default: 'INFO',
  http: 'INFO',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

// add severity level to work on GCP stackdriver
// reference: https://gist.github.com/jasperkuperus/9df894041e3d5216ce25af03d38ec3f1
const stackdriverFormat = format((data) => {
  data.severity = STACKDRIVER_SEVERITY[data[LEVEL]] || STACKDRIVER_SEVERITY.default;
  return data;
});

let inited = false;
export function startup(params) {
  if (inited) {
    return;
  }
  params = params || {};
  inited = true;
  let options = { transports: [] };

  let server_config = serverConfig();
  let config_log = server_config.log || {};
  let level = config_log.level || 'debug';
  if (params.transports) {
    options.transports = options.transports.concat(params.transports);
  } else {
    let args = [];
    let stderrLevels;
    if (config_log.stackdriver) {
      // Structured logging for Stackdriver through the console
      stderrLevels = ['error'];
      //args.push(format.timestamp()); // doesn't seem to be needed
      args.push(stackdriverFormat());
      args.push(format.json());
    } else {
      // Human-readable/grep-able console logger
      dumpToFile = true;
      let timestamp_format = config_log.timestamp_format;
      let log_format = server_config.log && server_config.log.format;
      args.push(format.metadata());
      if (timestamp_format === 'long') {
        args.push(format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZZ' }));
      } else {
        args.push(format.timestamp({ format: 'HH:mm:ss' }));
        args.push(format.padLevels());
      }
      if (log_format === 'dev' || !log_format && argv.dev) {
        args.push(format.colorize());
        args.push(
          format.printf(function (data) {
            let meta = Object.keys(data.metadata).length !== 0 ? ` | ${inspect(data.metadata)}` : '';
            return `[${data.timestamp}] ${data.level} ${data.message} ${meta}`;
          })
        );
      } else {
        args.push(
          format.printf(function (data) {
            let meta = Object.keys(data.metadata).length !== 0 ? ` | ${inspect(data.metadata)}` : '';
            return `[${data.timestamp} ${pid} ${last_uid++}] ${data.level} ${data.message} ${meta}`;
          })
        );
      }
    }
    let format_param = format.combine(...args);
    if (argv.dev) {
      // DOES forward to debugger
      options.transports.push(
        new SimpleConsoleTransport({
          level,
          format: format_param,
        })
      );
    } else {
      // Does NOT forward to an interactive debugger (due to bug? useful, though)
      options.transports.push(
        new winston.transports.Console({
          level,
          format: format_param,
          stderrLevels,
        })
      );
    }
  }

  logger = winston.createLogger(options);
  //debug('TESTING DEBUG LEVEL');
  //info('TESTING INFO LEVEL');
  //warn('TESTING WARN LEVEL', { foo: 'bar' });
  //error('TESTING ERROR LEVEL', { foo: 'bar' }, { baaz: 'quux' });

  if (dumpToFile && !fs.existsSync(log_dir)) {
    console.info(`Creating ${log_dir}...`);
    fs.mkdirSync(log_dir);
  }

  Object.keys(LOG_LEVELS).forEach(function (fn) {
    let logfn = logger.log.bind(logger, fn === 'log' ? 'info' : fn);
    let metric = `log.${fn}`;
    raw_console[fn] = console[fn];
    console[fn] = function (...args) {
      metrics.add(metric, 1);
      if (!dumpToFile && args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'object') {
        // `message, data` format
        logfn(args[0], args[1]);
      } else {
        // anything else, convert to string
        let msg = (args || []).map(argProcessor).join(' ');
        logfn(msg);
      }
    };
  });

  // console.debug('TESTING DEBUG LEVEL');
  // console.info('TESTING INFO LEVEL');
  // console.warn('TESTING WARN LEVEL', { foo: 'bar' });
  // console.error('TESTING ERROR LEVEL', { foo: 'bar' }, { baaz: 'quux' });
  // console.error('TESTING ERROR LEVEL', new Error('error param'));
  // console.error(new Error('raw error'));
  // console.info({ testing: 'info object' });
  // console.info('testing object param', { testing: 'info object' });
}
