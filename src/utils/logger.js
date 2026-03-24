const winston = require('winston');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let metaString = '';
  if (Object.keys(meta).length) {
    metaString = ' ' + JSON.stringify(meta);
  }
  return `${timestamp} [${level}]: ${stack || message}${metaString}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
  ],
});

module.exports = logger;
