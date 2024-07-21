import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// winston.format.json(),
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

const transport1: DailyRotateFile = new DailyRotateFile({
  level: 'info',
  filename: 'logs/info-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d'
});

var transport2: DailyRotateFile = new winston.transports.DailyRotateFile({
  level: 'error',
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d'
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
    format: winston.format.simple(),
  }));
}
