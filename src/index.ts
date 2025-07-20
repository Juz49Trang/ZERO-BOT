import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { ArbitrageScanner } from './services/ArbitrageScanner';
import { TradeExecutor } from './services/TradeExecutor';
import { logger, printBanner } from './utils/logger';
import { BotConfig, ArbitrageOpportunity, ArbitrageStatus, TokenInfo } from './types';
import { TOKENS, DEXES, ERC20_ABI } from './config/constants';

// Load environment variables
dotenv.config();

class ZeroBot {
  private config: BotConfig;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private scanner: ArbitrageScanner;
  private executor: TradeExecutor;
  private status: ArbitrageStatus = ArbitrageStatus.IDLE;
  private totalProfit: bigint = 0n;
  private tradesExecuted: number = 0;

  constructor() {
    this.config = this.loadConfig();
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
    this.scanner = new ArbitrageScanner(this.provider, this.config);
    this.executor = new TradeExecutor(this.wallet);
  }

  private loadConfig(): BotConfig {
    const requiredEnvVars = [
      'RPC_URL',
      'PRIVATE_KEY',
      'MIN_PROFIT_THRESHOLD',
      'MAX_GAS_PRICE_GWEI',
      'TRADE_AMOUNT_ETH'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    return {
      rpcUrl: process.env.RPC_URL!,
      chainId: parseInt(process.env.CHAIN_ID || '8453'),
      privateKey: process.env.PRIVATE_KEY!,
      minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD!),
      maxGasPriceGwei: parseFloat(process.env.MAX_GAS_PRICE_GWEI!),
      tradeAmountETH: parseFloat(process.env.TRADE_AMOUNT_ETH!),
      priceCheckIntervalMs: parseInt(process.env.PRICE_CHECK_INTERVAL_MS || '2000')
    };
  }

  async start() {
    printBanner();
    
    logger.info('🤖 ZERO-BOT initializing...');
    logger.info(`📍 Chain: Base (ID: ${this.config.chainId})`);
    logger.info(`💰 Wallet: ${this.wallet.address}`);
    logger.info(`💸 Trade Amount: ${this.config.tradeAmountETH} ETH`);
    logger.info(`📈 Min Profit Threshold: ${this.config.minProfitThreshold * 100}%`);

    // Check wallet balance
    await this.checkBalances();
    
    // Initialize token approvals once at startup
    await this.initializeApprovals();

    // Setup graceful shutdown
    this.setupShutdownHandlers();

    // Start scanning
    this.status = ArbitrageStatus.SCANNING;
    await this.scanner.startScanning(this.handleOpportunity.bind(this));
  }

  private async checkBalances() {
    const ethBalance = await this.provider.getBalance(this.wallet.address);
    logger.info(`💎 ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

    // Need enough ETH for gas (approx 0.01 ETH) plus some buffer
    const minEthRequired = ethers.parseEther('0.01');
    if (ethBalance < minEthRequired) {
      throw new Error(`Insufficient ETH balance for gas. Need at least 0.01 ETH, have ${ethers.formatEther(ethBalance)} ETH`);
    }

    // Check WETH balance for trading
    const wethContract = new ethers.Contract(
      TOKENS.WETH.address,
      ERC20_ABI,
      this.provider
    );
    const wethBalance = await wethContract.balanceOf(this.wallet.address);
    const minWethRequired = ethers.parseEther(this.config.tradeAmountETH.toString());
    
    if (wethBalance < minWethRequired) {
      throw new Error(`Insufficient WETH balance for trading. Need ${this.config.tradeAmountETH} WETH, have ${ethers.formatUnits(wethBalance, 18)} WETH`);
    }

    // Check major token balances
    for (const [symbol, token] of Object.entries(TOKENS)) {
      try {
        const tokenInfo = token as TokenInfo;
        const contract = new ethers.Contract(
          tokenInfo.address,
          ['function balanceOf(address) view returns (uint256)'],
          this.provider
        );
        const balance = await contract.balanceOf(this.wallet.address);
        if (balance > 0n) {
          logger.info(`🪙  ${symbol} Balance: ${ethers.formatUnits(balance, tokenInfo.decimals)}`);
        }
      } catch (error) {
        // Skip if error
      }
    }
  }

  private async handleOpportunity(opportunity: ArbitrageOpportunity) {
    if (this.status === ArbitrageStatus.EXECUTING) {
      logger.info('Already executing a trade, skipping opportunity');
      return;
    }

    this.status = ArbitrageStatus.EXECUTING;

    try {
      logger.info(`
╔════════════════════════════════════════╗
║        ARBITRAGE OPPORTUNITY           ║
╠════════════════════════════════════════╣
║ Pair: ${opportunity.tokenA.symbol} <-> ${opportunity.tokenB.symbol}
║ Buy on: ${opportunity.buyDEX}
║ Sell on: ${opportunity.sellDEX}
║ Expected Profit: ${opportunity.profitPercent.toFixed(2)}%
║ Net Profit: ${ethers.formatEther(opportunity.netProfit)} ETH
╚════════════════════════════════════════╝
      `);

      const result = await this.executor.executeArbitrage(opportunity);

      if (result.success) {
        this.tradesExecuted++;
        this.totalProfit += result.profit || 0n;
        
        logger.info(`
✅ TRADE SUCCESSFUL!
📊 Trades Executed: ${this.tradesExecuted}
💰 Total Profit: ${ethers.formatEther(this.totalProfit)} ETH
🔗 TX: ${result.txHash}
        `);
      } else {
        logger.error(`Trade failed: ${result.error}`);
      }

    } catch (error) {
      logger.error('Error handling opportunity:', error);
    } finally {
      this.status = ArbitrageStatus.SCANNING;
    }
  }

  private async initializeApprovals() {
    logger.info('🔐 Initializing token approvals...');
    
    // Get all DEX routers
    const routers = Object.values(DEXES).map((dex: any) => dex.router);
    
    // Get all tokens we might trade
    const tokensToApprove = ['WETH', 'USDC', 'DAI', 'BMO'];
    
    for (const tokenSymbol of tokensToApprove) {
      const token = TOKENS[tokenSymbol];
      if (!token) continue;
      
      for (const router of routers) {
        try {
          const tokenContract = new ethers.Contract(
            token.address,
            ERC20_ABI,
            this.wallet
          );
          
          const allowance = await tokenContract.allowance(
            this.wallet.address,
            router
          );
          
          if (allowance < ethers.parseUnits('1000000', token.decimals)) {
            logger.info(`Approving ${tokenSymbol} for router ${router}...`);
            const tx = await tokenContract.approve(
              router,
              ethers.MaxUint256
            );
            await tx.wait();
            logger.info(`✅ ${tokenSymbol} approved for ${router}`);
          } else {
            logger.info(`✅ ${tokenSymbol} already approved for ${router}`);
          }
        } catch (error) {
          logger.warn(`Failed to approve ${tokenSymbol} for ${router}:`, error);
        }
      }
    }
    
    logger.info('✅ Token approvals initialized');
  }

  private setupShutdownHandlers() {
    const shutdown = async () => {
      logger.info('\n👋 Shutting down ZERO-BOT...');
      this.scanner.stopScanning();
      
      logger.info(`
╔════════════════════════════════════════╗
║           SESSION SUMMARY              ║
╠════════════════════════════════════════╣
║ Total Trades: ${this.tradesExecuted}
║ Total Profit: ${ethers.formatEther(this.totalProfit)} ETH
╚════════════════════════════════════════╝
      `);
      
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// Main entry point
async function main() {
  try {
    const bot = new ZeroBot();
    await bot.start();
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch(console.error);