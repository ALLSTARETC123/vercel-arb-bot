import { Connection, Keypair, VersionedTransaction, TransactionMessage, PublicKey } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import bs58 from 'bs58';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log('Sequential multi-pair scan engine initiated...');

  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  const tradeAmount = process.env.TRADE_AMOUNT;
  const minProfitThreshold = Number(process.env.MIN_PROFIT_THRESHOLD || 1000);

  if (!rpcUrl || !privateKey || !tradeAmount) {
    console.error('Missing required environment configuration.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  const jupiterApi = createJupiterApiClient();

  const pairs = [
    ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'], // WSOL -> USDC
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112'], // USDC -> WSOL
    ['So11111111111111111111111111111111111111112', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'], // WSOL -> JUP
    ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 'So11111111111111111111111111111111111111112'], // JUP -> WSOL
    ['So11111111111111111111111111111111111111112', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'], // WSOL -> BONK
    ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'So11111111111111111111111111111111111111112']  // BONK -> WSOL
  ];

  let bestOpportunity = null;
  let maxProfit = 0;

  for (const [inputMint, outputMint] of pairs) {
    try {
      const quoteData = await jupiterApi.quoteGet({
        inputMint,
        outputMint,
        amount: Number(tradeAmount),
        slippageBps: 50,
        onlyDirectRoutes: false
      });

      if (quoteData && quoteData.outAmount && quoteData.inAmount) {
        const inAmt = BigInt(quoteData.inAmount);
        const outAmt = BigInt(quoteData.outAmount);
        const estimatedProfit = outAmt > inAmt ? Number(outAmt - inAmt) : 0;

        console.log(`Checked pair | Estimated Profit: ${estimatedProfit} lamports`);

        if (estimatedProfit > maxProfit) {
          maxProfit = estimatedProfit;
          bestOpportunity = { quoteData, inputMint, outputMint, estimatedProfit };
        }
      }
    } catch (err) {
      console.log(`Quote skipped due to routing response error.`);
    }
    await sleep(400);
  }

  if (!bestOpportunity || bestOpportunity.estimatedProfit < minProfitThreshold) {
    console.log(`Scan completed. Max net profit found (${maxProfit} lamports) did not meet threshold (${minProfitThreshold}). Aborting cleanly.`);
    process.exit(0);
  }

  console.log(`Profitable route found! Estimated Net Profit: ${bestOpportunity.estimatedProfit} lamports.`);

  let instructionsData;
  try {
    instructionsData = await jupiterApi.swapInstructionsPost({
      swapRequest: {
        quoteResponse: bestOpportunity.quoteData,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: false,
        useSharedAccounts: false
      }
    });
  } catch (e) {
    console.log(`Instructions fetch failed: ${e.message}`);
    process.exit(0);
  }

  const parseInstruction = (ix) => ({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable
    })),
    data: Buffer.from(ix.data, 'base64')
  });

  const ataProgramId = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const rawInstructions = [
    ...(instructionsData.computeBudgetInstructions || []),
    ...(instructionsData.setupInstructions || []),
    instructionsData.swapInstruction,
    ...(instructionsData.cleanupInstruction ? [instructionsData.cleanupInstruction] : [])
  ].filter(Boolean);

  const filteredInstructions = rawInstructions
    .filter((ix) => ix.programId !== ataProgramId)
    .map(parseInstruction);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: filteredInstructions
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet]);

  try {
    const txid = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 2
    });
    console.log(`Arbitrage transaction broadcasted: https://solscan.io/tx/${txid}`);
  } catch (err) {
    console.log(`Execution failed on-chain: ${err.message}`);
    process.exit(0);
  }
})().catch((err) => {
  console.error(`Fatal script error: ${err.stack || err.message}`);
  process.exit(1);
});
