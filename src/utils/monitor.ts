import { ethers } from 'ethers';
import chalk from 'chalk';

export interface BotMetrics {
  startTime: Date;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: bigint;
  totalGasSpent: bigint;
  averageProfit: bigint;
  bestTrade: {
    profit: bigint;
    pair: string;
    timestamp: Date;
  } | null;
  currentStreak: number;
  maxStreak: number;
}

export class BotMonitor {
  private metrics: BotMetrics;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.metrics = {
      startTime: new Date(),
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalProfit: 0n,
      totalGasSpent: 0n,
      averageProfit: 0n,
      bestTrade: null,
      currentStreak: 0,
      maxStreak: 0
    };
  }

  startDashboard() {
    this.updateInterval = setInterval(() => {
      this.displayDashboard();
    }, 5000);
  }

  stopDashboard() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }

  recordTrade(success: boolean, profit: bigint, gasUsed: bigint, pair: string) {
    this.metrics.totalTrades++;
    
    if (success) {
      this.metrics.successfulTrades++;
      this.metrics.totalProfit += profit;
      this.metrics.currentStreak++;
      
      if (this.metrics.currentStreak > this.metrics.maxStreak) {
        this.metrics.maxStreak = this.metrics.currentStreak;
      }
      
      if (!this.metrics.bestTrade || profit > this.metrics.bestTrade.profit) {
        this.metrics.bestTrade = {
          profit,
          pair,
          timestamp: new Date()
        };
      }
    } else {
      this.metrics.failedTrades++;
      this.metrics.currentStreak = 0;
    }
    
    this.metrics.totalGasSpent += gasUsed;
    
    if (this.metrics.successfulTrades > 0) {
      this.metrics.averageProfit = this.metrics.totalProfit / BigInt(this.metrics.successfulTrades);
    }
  }

  private displayDashboard() {
    console.clear();
    
    const runtime = this.getRuntime();
    const successRate = this.metrics.totalTrades > 0 
      ? ((this.metrics.successfulTrades / this.metrics.totalTrades) * 100).toFixed(1)
      : '0.0';
    
    console.log(chalk.cyan.bold(`
╔════════════════════════════════════════════════════════╗
║                 ZERO-BOT DASHBOARD                     ║
╚════════════════════════════════════════════════════════╝`));
    
    console.log(chalk.white(`
📊 Performance Metrics
─────────────────────
Runtime:          ${runtime}
Total Trades:     ${this.metrics.totalTrades}
Successful:       ${chalk.green(this.metrics.successfulTrades)} (${chalk.green(successRate + '%')})
Failed:           ${chalk.red(this.metrics.failedTrades)}
Current Streak:   ${this.metrics.currentStreak}
Best Streak:      ${this.metrics.maxStreak}

💰 Financial Summary
─────────────────────
Total Profit:     ${chalk.green(ethers.formatEther(this.metrics.totalProfit) + ' ETH')}
Total Gas Spent:  ${chalk.yellow(ethers.formatEther(this.metrics.totalGasSpent) + ' ETH')}
Net Profit:       ${chalk.bold.green(ethers.formatEther(this.metrics.totalProfit - this.metrics.totalGasSpent) + ' ETH')}
Avg Profit/Trade: ${ethers.formatEther(this.metrics.averageProfit) + ' ETH'}
`));

    if (this.metrics.bestTrade) {
      console.log(chalk.white(`
🏆 Best Trade
─────────────────────
Pair:     ${this.metrics.bestTrade.pair}
Profit:   ${chalk.bold.green(ethers.formatEther(this.metrics.bestTrade.profit) + ' ETH')}
Time:     ${this.metrics.bestTrade.timestamp.toLocaleTimeString()}
`));
    }
  }

  private getRuntime(): string {
    const ms = Date.now() - this.metrics.startTime.getTime();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  getMetrics(): BotMetrics {
    return { ...this.metrics };
  }
}