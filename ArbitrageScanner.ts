import { ethers } from 'ethers';
import { ArbitrageOpportunity, TokenInfo, BotConfig } from '../types';
import { DEXES, TOKENS, TRADING_PAIRS } from '../config/constants';
import { PriceMonitor } from './PriceMonitor';
import { logger } from '../utils/logger';

export class ArbitrageScanner {
  private provider: ethers.Provider;
  private priceMonitor: PriceMonitor;
  private config: BotConfig;
  private scanning: boolean = false;

  constructor(provider: ethers.Provider, config: BotConfig) {
    this.provider = provider;
    this.priceMonitor = new PriceMonitor(provider);
    this.config = config;
  }

  async startScanning(callback: (opportunity: ArbitrageOpportunity) => Promise<void>) {
    this.scanning = true;
    logger.info('🔍 Starting arbitrage scanner...');
    
    let scanCount = 0;

    while (this.scanning) {
      try {
        scanCount++;
        if (scanCount % 10 === 0) {
          logger.debug(`Completed ${scanCount} scan cycles...`);
        }
        
        const opportunities = await this.scanForOpportunities();
        
        if (opportunities.length === 0 && scanCount % 20 === 0) {
          logger.info('👀 Still scanning... No profitable opportunities found yet.');
        }
        
        for (const opportunity of opportunities) {
          if (opportunity.profitPercent >= this.config.minProfitThreshold) {
            logger.info('💎 Profitable opportunity found!', { opportunity });
            await callback(opportunity);
          }
        }
      } catch (error) {
        logger.error('Error in scan cycle:', error);
      }

      await this.sleep(this.config.priceCheckIntervalMs);
    }
  }

  stopScanning() {
    this.scanning = false;
    logger.info('🛑 Stopping arbitrage scanner...');
  }

  private async scanForOpportunities(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    for (const pair of TRADING_PAIRS) {
      const tokenA = TOKENS[pair.tokenA];
      const tokenB = TOKENS[pair.tokenB];
      
      if (!tokenA || !tokenB) continue;

      // Calculate amount based on config
      const amountIn = ethers.parseUnits(
        this.config.tradeAmountETH.toString(),
        tokenA.decimals
      );

      // Get quotes from all DEXes for A -> B
      const quotesAtoB = await this.getQuotesFromAllDexes(tokenA, tokenB, amountIn);
      
      if (quotesAtoB.length < 2) continue;

      // Find arbitrage opportunities
      for (let i = 0; i < quotesAtoB.length; i++) {
        for (let j = 0; j < quotesAtoB.length; j++) {
          if (i === j) continue;

          const buyQuote = quotesAtoB[i];
          const sellDexQuote = quotesAtoB[j];

          // Calculate reverse quote: how much tokenA we get back
          // Use the output from the buy quote as input for sell
          const reverseQuote = await this.priceMonitor.getQuoteV3(
            DEXES[sellDexQuote.dexName],
            tokenB,
            tokenA,
            buyQuote.quote.outputAmount // Use the exact output from buy
          );

          if (!reverseQuote) continue;

          // Check if profitable
          const profitAmount = reverseQuote.outputAmount > amountIn 
            ? reverseQuote.outputAmount - amountIn 
            : 0n;

          if (profitAmount > 0n) {
            const profitPercent = Number(profitAmount * 10000n / amountIn) / 100;
            const estimatedGasCost = await this.estimateGasCost(
              buyQuote.quote.gasEstimate! + reverseQuote.gasEstimate!
            );

            // Calculate net profit
            const profitInETH = tokenA.symbol === 'WETH' 
              ? profitAmount 
              : await this.convertToETH(profitAmount, tokenA);

            const netProfit = profitInETH > estimatedGasCost 
              ? profitInETH - estimatedGasCost 
              : 0n;

            const netProfitPercent = Number(netProfit * 10000n / amountIn) / 100;

            // Validate the opportunity is realistic
            if (netProfitPercent >= this.config.minProfitThreshold && 
                netProfitPercent < 10 && // Lower threshold to 10% max
                reverseQuote.outputAmount > 0n &&
                buyQuote.quote.outputAmount > 0n) {
              opportunities.push({
                tokenA,
                tokenB,
                buyDEX: buyQuote.dexName,
                sellDEX: sellDexQuote.dexName,
                buyPrice: buyQuote.quote.price,
                sellPrice: 1 / reverseQuote.price, // Inverse for sell price
                profitPercent: netProfitPercent,
                profitAmount: netProfit,
                buyQuote: buyQuote.quote,
                sellQuote: reverseQuote,
                estimatedGasCost,
                netProfit
              });
            }
          }
        }
      }
    }

    return opportunities;
  }

  private async getQuotesFromAllDexes(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: bigint
  ): Promise<Array<{ dexName: string; quote: any }>> {
    const quotes: Array<{ dexName: string; quote: any }> = [];

    for (const [dexName, dexInfo] of Object.entries(DEXES)) {
      try {
        const quote = await this.priceMonitor.getQuoteV3(
          dexInfo,
          tokenIn,
          tokenOut,
          amountIn
        );

        if (quote && quote.outputAmount > 0n) {
          quotes.push({ dexName, quote });
        }
      } catch (error) {
        logger.debug(`Failed to get quote from ${dexName}:`, error);
      }
    }

    return quotes;
  }

  private async estimateGasCost(gasEstimate: bigint): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
      
      // Add 20% buffer for safety
      return (gasEstimate * gasPrice * 120n) / 100n;
    } catch (error) {
      // Fallback to configured max gas price
      return gasEstimate * ethers.parseUnits(this.config.maxGasPriceGwei.toString(), 'gwei');
    }
  }

  private async convertToETH(amount: bigint, token: TokenInfo): Promise<bigint> {
    if (token.symbol === 'WETH') return amount;

    try {
      const quote = await this.priceMonitor.getQuoteV3(
        DEXES.UNISWAP_V3,
        token,
        TOKENS.WETH,
        amount
      );

      return quote?.outputAmount || 0n;
    } catch (error) {
      return 0n;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}