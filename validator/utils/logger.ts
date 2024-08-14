import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// winston.format.json(),
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DDThh:mm:ssZ'
  }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);
const filePath = process.env.LOGGER_DIR || 'logs';
const maxSize = process.env.LOGGER_MAX_SIZE || '20m';
const maxFiles = process.env.LOGGER_MAX_FILES || '30d';

const transport1: DailyRotateFile = new DailyRotateFile({
  level: 'info',
  filename: `${filePath}/info-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: `${maxSize}`,
  maxFiles: `${maxFiles}`
});

var transport2: DailyRotateFile = new winston.transports.DailyRotateFile({
  level: 'info',
  filename: `${filePath}/info-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: `${maxSize}`,
  maxFiles: `${maxFiles}`
});

// Create a new Winston logger instance
export const logger = winston.createLogger({
  format: customFormat,
  transports: [
    transport1,
    transport2,
  ],
});

// If it is not a production environment, the log is printed in the console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
  }));
}
