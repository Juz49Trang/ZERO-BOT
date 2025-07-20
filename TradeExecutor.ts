import { ethers } from 'ethers';
import { ArbitrageOpportunity, TradeResult } from '../types';
import { DEXES, ERC20_ABI } from '../config/constants';
import { logger } from '../utils/logger';

// Proven working ABIs
const UNISWAP_V3_ABI = [
  {
    "inputs": [{
      "components": [
        {"name": "tokenIn", "type": "address"},
        {"name": "tokenOut", "type": "address"},
        {"name": "fee", "type": "uint24"},
        {"name": "recipient", "type": "address"},
        {"name": "amountIn", "type": "uint256"},
        {"name": "amountOutMinimum", "type": "uint256"},
        {"name": "sqrtPriceLimitX96", "type": "uint160"}
      ],
      "name": "params",
      "type": "tuple"
    }],
    "name": "exactInputSingle",
    "outputs": [{"name": "amountOut", "type": "uint256"}],
    "stateMutability": "payable",
    "type": "function"
  }
];

const PANCAKESWAP_V3_ABI = [
  {
    "inputs": [
      { "name": "tokenIn", "type": "address" },
      { "name": "tokenOut", "type": "address" },
      { "name": "fee", "type": "uint24" },
      { "name": "recipient", "type": "address" },
      { "name": "deadline", "type": "uint256" },
      { "name": "amountIn", "type": "uint256" },
      { "name": "amountOutMinimum", "type": "uint256" },
      { "name": "sqrtPriceLimitX96", "type": "uint160" }
    ],
    "name": "exactInputSingle",
    "outputs": [{ "name": "amountOut", "type": "uint256" }],
    "stateMutability": "payable",
    "type": "function"
  }
];

export class TradeExecutor {
  private wallet: ethers.Wallet;
  private approvedTokens: Set<string> = new Set();
  private executedTrades: number = 0;
  private totalProfit: bigint = 0n;

  constructor(wallet: ethers.Wallet) {
    this.wallet = wallet;
  }

  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<TradeResult> {
    try {
      logger.info('🚀 Starting arbitrage execution...');
      const startTime = Date.now();

      // Pre-flight checks
      await this.validateOpportunity(opportunity);

      // Execute buy trade
      logger.info(`📈 Buying ${opportunity.tokenB.symbol} on ${opportunity.buyDEX}`);
      const buyResult = await this.executeSingleTrade(
        opportunity.buyDEX,
        opportunity.tokenA,
        opportunity.tokenB,
        opportunity.buyQuote.inputAmount,
        opportunity.buyQuote.outputAmount,
        'BUY'
      );

      if (!buyResult.success) {
        throw new Error(`Buy trade failed: ${buyResult.error}`);
      }

      // Wait for state update
      await this.sleep(1000);

      // Get actual received amount
      const receivedAmount = await this.getReceivedAmount(
        opportunity.tokenB,
        buyResult.balanceBefore!,
        opportunity.buyQuote.outputAmount
      );

      logger.info(`✅ Buy complete. Received: ${ethers.formatUnits(receivedAmount, opportunity.tokenB.decimals)} ${opportunity.tokenB.symbol}`);

      // Execute sell trade with actual received amount
      logger.info(`📉 Selling ${opportunity.tokenB.symbol} on ${opportunity.sellDEX}`);
      const sellResult = await this.executeSingleTrade(
        opportunity.sellDEX,
        opportunity.tokenB,
        opportunity.tokenA,
        receivedAmount,
        opportunity.sellQuote.outputAmount,
        'SELL'
      );

      if (!sellResult.success) {
        throw new Error(`Sell trade failed: ${sellResult.error}`);
      }

      // Calculate actual profit
      const totalGasUsed = (buyResult.gasUsed || 0n) + (sellResult.gasUsed || 0n);
      const executionTime = Date.now() - startTime;

      this.executedTrades++;
      this.totalProfit += opportunity.netProfit - totalGasUsed;

      logger.info(`
✅ ARBITRAGE COMPLETE!
⏱️  Execution time: ${executionTime}ms
💰 Expected profit: ${ethers.formatEther(opportunity.netProfit)} ETH
⛽ Gas cost: ${ethers.formatEther(totalGasUsed)} ETH
📊 Total trades: ${this.executedTrades}
💸 Total profit: ${ethers.formatEther(this.totalProfit)} ETH
      `);

      return {
        success: true,
        txHash: sellResult.txHash,
        profit: opportunity.netProfit - totalGasUsed,
        gasUsed: totalGasUsed
      };

    } catch (error) {
      logger.error('Arbitrage execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async executeSingleTrade(
    dexName: string,
    tokenIn: any,
    tokenOut: any,
    amountIn: bigint,
    expectedAmountOut: bigint,
    tradeType: 'BUY' | 'SELL'
  ): Promise<TradeResult & { balanceBefore?: bigint }> {
    try {
      const dex = DEXES[dexName];
      
      // Get balance before trade
      const tokenOutContract = new ethers.Contract(tokenOut.address, ERC20_ABI, this.wallet);
      const balanceBefore = await tokenOutContract.balanceOf(this.wallet.address);

      // Ensure approval
      await this.ensureApproval(tokenIn.address, dex.router, amountIn);

      // Create router contract with correct ABI
      const routerAbi = dexName === 'PANCAKESWAP_V3' ? PANCAKESWAP_V3_ABI : UNISWAP_V3_ABI;
      const router = new ethers.Contract(dex.router, routerAbi, this.wallet);

      // Calculate slippage
      const slippage = tradeType === 'BUY' ? 0.02 : 0.05; // 2% for buys, 5% for sells
      const minAmountOut = expectedAmountOut - (expectedAmountOut * BigInt(Math.floor(slippage * 10000)) / 10000n);

      // Find best fee tier
      const fee = await this.findBestFeeTier(dex, tokenIn, tokenOut);

      logger.info(`Executing ${tradeType} trade:`);
      logger.info(`  DEX: ${dexName}`);
      logger.info(`  Input: ${ethers.formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`);
      logger.info(`  Min output: ${ethers.formatUnits(minAmountOut, tokenOut.decimals)} ${tokenOut.symbol}`);
      logger.info(`  Fee tier: ${fee/10000}%`);

      let tx: ethers.TransactionResponse;

      if (dexName === 'PANCAKESWAP_V3') {
        // PancakeSwap format
        const deadline = Math.floor(Date.now() / 1000) + 300;
        
        // Manually encode the function call
        const iface = new ethers.Interface(PANCAKESWAP_V3_ABI);
        const data = iface.encodeFunctionData('exactInputSingle', [
          tokenIn.address,
          tokenOut.address,
          fee,
          this.wallet.address,
          deadline,
          amountIn,
          minAmountOut,
          0
        ]);
        
        console.log('PancakeSwap encoded data:', data.substring(0, 66) + '...');
        
        tx = await this.wallet.sendTransaction({
          to: dex.router,
          data: data,
          gasLimit: 400000
        });
      } else {
        // Uniswap format
        const params = {
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          fee: fee,
          recipient: this.wallet.address,
          amountIn: amountIn,
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0
        };
        
        // Manually encode the function call
        const iface = new ethers.Interface(UNISWAP_V3_ABI);
        const data = iface.encodeFunctionData('exactInputSingle', [params]);
        
        console.log('Uniswap encoded data:', data.substring(0, 66) + '...');
        
        tx = await this.wallet.sendTransaction({
          to: dex.router,
          data: data,
          gasLimit: 400000
        });
      }

      logger.info(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        throw new Error('Transaction failed');
      }

      const gasUsed = receipt.gasUsed * (receipt.gasPrice || 0n);
      logger.info(`✅ Trade confirmed. Gas used: ${ethers.formatEther(gasUsed)} ETH`);

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: gasUsed,
        balanceBefore: balanceBefore
      };

    } catch (error: any) {
      logger.error(`Trade execution error:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async validateOpportunity(opportunity: ArbitrageOpportunity) {
    // Check WETH balance
    const wethContract = new ethers.Contract(
      opportunity.tokenA.address,
      ERC20_ABI,
      this.wallet
    );
    const wethBalance = await wethContract.balanceOf(this.wallet.address);
    
    if (wethBalance < opportunity.buyQuote.inputAmount) {
      throw new Error(`Insufficient WETH. Have: ${ethers.formatEther(wethBalance)}, Need: ${ethers.formatEther(opportunity.buyQuote.inputAmount)}`);
    }

    // Sanity check profit
    if (opportunity.profitPercent > 10) {
      logger.warn(`⚠️ Unusually high profit: ${opportunity.profitPercent}%. Proceeding with caution.`);
    }
  }

  private async ensureApproval(tokenAddress: string, spender: string, amount: bigint) {
    const key = `${tokenAddress}-${spender}`;
    if (this.approvedTokens.has(key)) return;

    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const allowance = await token.allowance(this.wallet.address, spender);

    if (allowance < amount) {
      logger.info(`Approving ${tokenAddress} for ${spender}...`);
      const tx = await token.approve(spender, ethers.MaxUint256);
      await tx.wait();
      logger.info('✅ Approval confirmed');
    }

    this.approvedTokens.add(key);
  }

  private async getReceivedAmount(
    token: any,
    balanceBefore: bigint,
    expectedAmount: bigint
  ): Promise<bigint> {
    const tokenContract = new ethers.Contract(token.address, ERC20_ABI, this.wallet);
    const balanceAfter = await tokenContract.balanceOf(this.wallet.address);
    const received = balanceAfter - balanceBefore;

    if (received === 0n) {
      throw new Error('No tokens received from buy trade');
    }

    // Use 99% of received to account for rounding
    return (received * 99n) / 100n;
  }

  private async findBestFeeTier(dex: any, tokenIn: any, tokenOut: any): Promise<number> {
    const factoryAbi = ['function getPool(address,address,uint24) view returns (address)'];
    const factory = new ethers.Contract(dex.factory, factoryAbi, this.wallet);
    
    const feeTiers = dex.name === 'PancakeSwap V3' 
      ? [100, 500, 2500, 10000]
      : [100, 500, 3000, 10000];

    for (const fee of feeTiers) {
      try {
        const pool = await factory.getPool(tokenIn.address, tokenOut.address, fee);
        if (pool !== ethers.ZeroAddress) {
          return fee;
        }
      } catch (e) {
        continue;
      }
    }

    return dex.name === 'PancakeSwap V3' ? 500 : 3000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}