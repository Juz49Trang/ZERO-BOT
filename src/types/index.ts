// Type definitions for ZERO-BOT

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

export interface DEXInfo {
  name: string;
  router: string;
  factory: string;
  quoter?: string;
  version: 'V2' | 'V3';
}

export interface PriceQuote {
  dex: string;
  inputAmount: bigint;
  outputAmount: bigint;
  price: number;
  priceImpact: number;
  route: string[];
  gasEstimate?: bigint;
}

export interface ArbitrageOpportunity {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  buyDEX: string;
  sellDEX: string;
  buyPrice: number;
  sellPrice: number;
  profitPercent: number;
  profitAmount: bigint;
  buyQuote: PriceQuote;
  sellQuote: PriceQuote;
  estimatedGasCost: bigint;
  netProfit: bigint;
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  profit?: bigint;
  error?: string;
  gasUsed?: bigint;
}

export interface BotConfig {
  rpcUrl: string;
  chainId: number;
  privateKey: string;
  minProfitThreshold: number;
  maxGasPriceGwei: number;
  tradeAmountETH: number;
  priceCheckIntervalMs: number;
}

export enum ArbitrageStatus {
  IDLE = 'IDLE',
  SCANNING = 'SCANNING',
  OPPORTUNITY_FOUND = 'OPPORTUNITY_FOUND',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}