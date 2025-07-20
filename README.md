# ZERO-BOT - Base Chain Arbitrage Trading Bot

A high-performance arbitrage trading bot for Base chain, designed to identify and execute profitable trades across multiple DEXs.

## Features

- **Multi-DEX Support**: Monitors Uniswap V3, BaseSwap V3, and SushiSwap V3
- **Real-time Price Monitoring**: Continuous scanning for arbitrage opportunities
- **Automatic Execution**: Executes profitable trades automatically
- **Gas Optimization**: Smart gas estimation and monitoring
- **Comprehensive Logging**: Detailed logs for monitoring and debugging
- **Token Support**: WETH, USDC, DAI, USDbC, cbETH pairs

## Prerequisites

- Node.js v18 or higher
- TypeScript
- A wallet with sufficient ETH on Base chain
- RPC endpoint for Base chain

## Installation

1. Clone the repository and navigate to the project directory:
```bash
cd zero-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file from the example:
```bash
cp .env.example .env
```

4. Configure your `.env` file with your settings:
   - Add your private key (NEVER share this!)
   - Set your RPC URL (recommend using a private RPC for better performance)
   - Adjust trading parameters as needed

## Configuration

Key configuration parameters in `.env`:

- `MIN_PROFIT_THRESHOLD`: Minimum profit percentage to execute trades (default: 0.5%)
- `MAX_GAS_PRICE_GWEI`: Maximum gas price willing to pay
- `TRADE_AMOUNT_ETH`: Amount of ETH to use per trade
- `PRICE_CHECK_INTERVAL_MS`: How often to check for opportunities (milliseconds)

## Running the Bot

1. Build the TypeScript code:
```bash
npm run build
```

2. Start the bot:
```bash
npm start
```

Or run in development mode:
```bash
npm run dev
```

## How It Works

1. **Price Discovery**: The bot continuously monitors prices across configured DEXs
2. **Opportunity Detection**: Identifies price discrepancies between DEXs
3. **Profitability Calculation**: Calculates potential profit including gas costs
4. **Execution**: If profit exceeds threshold, executes the arbitrage trade
5. **Settlement**: Completes both legs of the trade atomically

## Architecture

```
src/
├── index.ts              # Main entry point
├── types/               # TypeScript type definitions
├── config/              # Configuration and constants
├── services/            # Core services
│   ├── ArbitrageScanner.ts   # Opportunity detection
│   ├── PriceMonitor.ts       # Price fetching
│   └── TradeExecutor.ts      # Trade execution
└── utils/               # Utility functions
```

## Safety Features

- Slippage protection (2% default)
- Gas price limits
- Minimum profit thresholds
- Balance checks before trading
- Automatic approval management

## Monitoring

The bot provides real-time feedback:
- Current prices across DEXs
- Identified opportunities
- Execution status
- Profit tracking
- Error logging

## Logs

- Console output for real-time monitoring
- `zero-bot.log` for all activities
- `zero-bot-error.log` for errors only

## Best Practices

1. **Start Small**: Begin with small trade amounts to test
2. **Monitor Gas**: Watch gas prices on Base
3. **Use Private RPC**: Public RPCs may be rate-limited
4. **Keep Funds Secure**: Only keep trading funds in the bot wallet
5. **Regular Updates**: Keep monitoring for new DEX deployments

## Optimization Tips

1. **Reduce Latency**: Use a fast RPC endpoint
2. **Adjust Intervals**: Balance between opportunity detection and RPC costs
3. **Token Selection**: Focus on high-volume pairs
4. **Gas Management**: Monitor Base gas prices for optimal execution

## Troubleshooting

### Common Issues:

1. **"Insufficient balance"**: Ensure wallet has enough ETH
2. **"No opportunities found"**: May need to adjust profit threshold
3. **"Transaction failed"**: Check gas settings and slippage
4. **"Rate limited"**: Switch to a private RPC endpoint

## Disclaimer

**USE AT YOUR OWN RISK**. This bot is for educational purposes. Arbitrage trading involves risks including:
- Smart contract risks
- Market volatility
- Network congestion
- Potential losses

Always test with small amounts first and never invest more than you can afford to lose.

## Future Enhancements

- Flash loan integration
- Cross-chain arbitrage
- MEV protection (when available on Base)
- Advanced routing algorithms
- Machine learning for opportunity prediction

## Support

For issues or questions, please review the code and logs carefully. This is an experimental bot and profits are not guaranteed.