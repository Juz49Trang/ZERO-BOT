import { ethers } from 'ethers';
import { PriceQuote, TokenInfo, DEXInfo } from '../types';
import { QUOTER_V3_ABI, FACTORY_V3_ABI, POOL_V3_ABI, FEE_TIERS } from '../config/constants';
import { logger } from '../utils/logger';
import NodeCache from 'node-cache';

export class PriceMonitor {
  private provider: ethers.Provider;
  private priceCache: NodeCache;
  private poolCache: Map<string, boolean> = new Map();

  constructor(provider: ethers.Provider) {
    this.provider = provider;
    this.priceCache = new NodeCache({ stdTTL: 3 }); // 3 second cache
  }

  async getQuoteV3(
    dexInfo: DEXInfo,
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: bigint
  ): Promise<PriceQuote | null> {
    try {
      const cacheKey = `${dexInfo.name}-${tokenIn.symbol}-${tokenOut.symbol}-${amountIn.toString()}`;
      const cached = this.priceCache.get<PriceQuote>(cacheKey);
      if (cached) return cached;

      let bestQuote: PriceQuote | null = null;
      let bestAmountOut = 0n;

      // Try all fee tiers
      for (const fee of FEE_TIERS) {
        try {
          const quote = await this.getQuoteForFeeTier(
            dexInfo,
            tokenIn,
            tokenOut,
            amountIn,
            fee
          );

          if (quote && quote.outputAmount > bestAmountOut) {
            bestAmountOut = quote.outputAmount;
            bestQuote = quote;
          }
        } catch (error) {
          // Fee tier might not have liquidity
          continue;
        }
      }

      if (bestQuote) {
        this.priceCache.set(cacheKey, bestQuote);
      }

      return bestQuote;
    } catch (error) {
      logger.error(`Error getting quote from ${dexInfo.name}:`, error);
      return null;
    }
  }

  private async getQuoteForFeeTier(
    dexInfo: DEXInfo,
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: bigint,
    fee: number
  ): Promise<PriceQuote | null> {
    try {
      const poolCacheKey = `${dexInfo.name}-${tokenIn.address}-${tokenOut.address}-${fee}`;
      
      // Check if we've already determined this pool doesn't exist
      if (this.poolCache.has(poolCacheKey) && !this.poolCache.get(poolCacheKey)) {
        return null;
      }

      // First check if pool exists
      const factory = new ethers.Contract(dexInfo.factory, FACTORY_V3_ABI, this.provider);
      const poolAddress = await factory.getPool(tokenIn.address, tokenOut.address, fee);
      
      if (poolAddress === ethers.ZeroAddress) {
        this.poolCache.set(poolCacheKey, false);
        return null;
      }

      // Check pool liquidity
      const pool = new ethers.Contract(poolAddress, POOL_V3_ABI, this.provider);
      const [slot0, liquidity] = await Promise.all([
        pool.slot0(),
        pool.liquidity()
      ]);

      if (liquidity === 0n) {
        this.poolCache.set(poolCacheKey, false);
        return null;
      }

      this.poolCache.set(poolCacheKey, true);

      // For now, skip quoter and use pool price directly to reduce RPC calls
      const amountOut = this.calculateOutputFromSqrtPrice(
        amountIn,
        slot0.sqrtPriceX96,
        tokenIn.decimals,
        tokenOut.decimals,
        tokenIn.address.toLowerCase() < tokenOut.address.toLowerCase()
      );

      if (amountOut === 0n) {
        return null;
      }

      const price = this.calculatePrice(
        amountIn,
        amountOut,
        tokenIn.decimals,
        tokenOut.decimals
      );

      return {
        dex: dexInfo.name,
        inputAmount: amountIn,
        outputAmount: amountOut,
        price,
        priceImpact: 0, // Simplified
        route: [tokenIn.symbol, tokenOut.symbol],
        gasEstimate: 150000n
      };
    } catch (error) {
      return null;
    }
  }

  private calculatePrice(
    amountIn: bigint,
    amountOut: bigint,
    decimalsIn: number,
    decimalsOut: number
  ): number {
    const adjustedIn = Number(amountIn) / (10 ** decimalsIn);
    const adjustedOut = Number(amountOut) / (10 ** decimalsOut);
    return adjustedOut / adjustedIn;
  }

  private calculatePriceImpact(
    amountIn: bigint,
    amountOut: bigint,
    sqrtPriceX96: bigint,
    decimalsIn: number,
    decimalsOut: number
  ): number {
    // Simplified price impact calculation
    const spotPrice = Number(sqrtPriceX96) ** 2 / (2 ** 192) * (10 ** (decimalsIn - decimalsOut));
    const executionPrice = this.calculatePrice(amountIn, amountOut, decimalsIn, decimalsOut);
    return Math.abs((executionPrice - spotPrice) / spotPrice);
  }

  private calculateOutputFromSqrtPrice(
    amountIn: bigint,
    sqrtPriceX96: bigint,
    decimalsIn: number,
    decimalsOut: number,
    token0IsInput: boolean
  ): bigint {
    try {
      // Convert sqrtPriceX96 to a regular price
      // price = (sqrtPriceX96 / 2^96)^2
      const Q96 = 2n ** 96n;
      
      if (token0IsInput) {
        // token0 -> token1: amountOut = amountIn * price
        const amountOut = (amountIn * sqrtPriceX96 * sqrtPriceX96) / (Q96 * Q96);
        // Adjust for decimals
        const decimalAdjustment = 10n ** BigInt(decimalsOut - decimalsIn);
        return amountOut * decimalAdjustment;
      } else {
        // token1 -> token0: amountOut = amountIn / price
        const amountOut = (amountIn * Q96 * Q96) / (sqrtPriceX96 * sqrtPriceX96);
        // Adjust for decimals
        const decimalAdjustment = 10n ** BigInt(decimalsOut - decimalsIn);
        return amountOut * decimalAdjustment;
      }
    } catch (error) {
      return 0n;
    }
  }

  async getBestQuote(
    dexes: Record<string, DEXInfo>,
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: bigint
  ): Promise<{ dexName: string; quote: PriceQuote } | null> {
    const quotes = await Promise.all(
      Object.entries(dexes).map(async ([name, dex]) => {
        const quote = await this.getQuoteV3(dex, tokenIn, tokenOut, amountIn);
        return { name, quote };
      })
    );

    const validQuotes = quotes.filter(q => q.quote !== null);
    
    if (validQuotes.length === 0) return null;

    // Find best output amount
    const best = validQuotes.reduce((best, current) => {
      if (!best.quote || (current.quote && current.quote.outputAmount > best.quote.outputAmount)) {
        return current;
      }
      return best;
    });

    return { dexName: best.name, quote: best.quote! };
  }
}