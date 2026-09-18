import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import bs58 from 'bs58';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log('Arbitrage scan and execution engine initialized...');

  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  const baseTradeAmountLamports = Number(process.env.TRADE_AMOUNT);
  const minProfitThreshold = Number(process.env.MIN_PROFIT_THRESHOLD || 1000);

  if (!rpcUrl || !privateKey || !baseTradeAmountLamports) {
    console.error('Missing required environment configuration.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  const jupiterApi = createJupiterApiClient();

  const solMint = 'So11111111111111111111111111111111111111112';
  const targetIntermediateMints = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'  // BONK
  ];

  let bestOpportunity = null;
  let maxProfit = 0n;

  for (const intermediateMint of targetIntermediateMints) {
    try {
      // Leg 1: Quote SOL -> Intermediate Token
      const leg1Quote = await jupiterApi.quoteGet({
        inputMint: solMint,
        outputMint: intermediateMint,
        amount: baseTradeAmountLamports,
        slippageBps: 30,
        restrictIntermediateTokens: true
      });

      if (!leg1Quote || !leg1Quote.outAmount) continue;

      // Leg 2: Quote Intermediate Token -> SOL
      const leg2Quote = await jupiterApi.quoteGet({
        inputMint: intermediateMint,
        outputMint: solMint,
        amount: Number(leg1Quote.outAmount),
        slippageBps: 30,
        restrictIntermediateTokens: true
      });

      if (!leg2Quote || !leg2Quote.outAmount) continue;

      const inAmt = BigInt(baseTradeAmountLamports);
      const outAmt = BigInt(leg2Quote.outAmount);
      const netProfit = outAmt - inAmt;

      console.log(`Evaluated loop SOL -> ${intermediateMint.slice(0, 4)}... -> SOL | Net Spread: ${netProfit.toString()} lamports`);

      if (netProfit > maxProfit) {
        maxProfit = netProfit;
        bestOpportunity = {
          quoteData: leg2Quote,
          intermediateMint,
          netProfit
        };
      }
    } catch (err) {
      console.log(`Scan warning on mint ${intermediateMint.slice(0, 4)}...: ${err.message}`);
    }
    await sleep(200);
  }

  if (!bestOpportunity || bestOpportunity.netProfit < BigInt(minProfitThreshold)) {
    console.log(`Scan cycle finished. Highest observed spread was ${maxProfit.toString()} lamports, failing to clear threshold of ${minProfitThreshold} lamports.`);
    process.exit(0);
  }

  console.log(`Profitable opportunity locked! Executing swap sequence for estimated profit of ${bestOpportunity.netProfit.toString()} lamports.`);

  const swapResponse = await jupiterApi.swapPost({
    swapRequest: {
      quoteResponse: bestOpportunity.quoteData,
      userPublicKey: wallet.publicKey.toString(),
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    }
  });

  if (!swapResponse || !swapResponse.swapTransaction) {
    throw new Error('Failed to deserialize swap transaction from Jupiter API.');
  }

  const transactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(transactionBuf);
  transaction.sign([wallet]);

  const rawTransaction = transaction.serialize();
  const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 3
  });

  console.log(`Arbitrage transaction broadcasted successfully: https://solscan.io/tx/${txid}`);
})().catch((err) => {
  console.error(`Execution error: ${err.stack || err.message}`);
  process.exit(1);
});
        
