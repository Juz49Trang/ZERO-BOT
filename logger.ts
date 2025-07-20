import winston from 'winston';
import chalk from 'chalk';

const logFormat = winston.format.printf(({ timestamp, level, message, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

const colorizeLevel = (level: string) => {
  switch (level) {
    case 'error': return chalk.red(level.toUpperCase());
    case 'warn': return chalk.yellow(level.toUpperCase());
    case 'info': return chalk.blue(level.toUpperCase());
    case 'debug': return chalk.gray(level.toUpperCase());
    default: return level.toUpperCase();
  }
};

const consoleFormat = winston.format.printf(({ timestamp, level, message, ...metadata }) => {
  const time = chalk.gray(timestamp);
  const coloredLevel = colorizeLevel(level);
  let msg = `${time} [${coloredLevel}]: ${message}`;
  
  if (metadata.opportunity) {
    const opp = metadata.opportunity as any;
    msg += chalk.green(`\n  💰 Profit: ${opp.profitPercent?.toFixed(2)}%`);
    msg += chalk.cyan(`\n  📈 Buy on ${opp.buyDEX}: ${opp.buyPrice?.toFixed(6)}`);
    msg += chalk.magenta(`\n  📉 Sell on ${opp.sellDEX}: ${opp.sellPrice?.toFixed(6)}`);
  }
  
  return msg;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        consoleFormat
      )
    }),
    new winston.transports.File({
      filename: 'zero-bot-error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.File({
      filename: 'zero-bot.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

// ASCII Art for startup
export const printBanner = () => {
  console.log(chalk.cyan(`
╔══════════════════════════════════════╗
║           ZERO-BOT v1.0.0            ║
║     Base Chain Arbitrage Bot         ║
╚══════════════════════════════════════╝
  `));
};