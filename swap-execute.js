import { Connection, Keypair, VersionedTransaction, TransactionMessage, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TOKEN_DECIMALS = {
  'So11111111111111111111111111111111111111112': 9,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 6,
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 5
};

(async () => {
  console.log('Arbitrage scan and execution engine initialized...');

  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  const baseTradeAmount = Number(process.env.TRADE_AMOUNT);
  const minProfitThreshold = Number(process.env.MIN_PROFIT_THRESHOLD || 1000);

  if (!rpcUrl || !privateKey || !baseTradeAmount) {
    console.error('Missing required environment configuration.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

  const pairs = [
    ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112'],
    ['So11111111111111111111111111111111111111112', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'],
    ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 'So11111111111111111111111111111111111111112'],
    ['So11111111111111111111111111111111111111112', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'],
    ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'So11111111111111111111111111111111111111112']
  ];

  const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  };

  let bestOpportunity = null;
  let maxProfit = 0;

  for (const [inputMint, outputMint] of pairs) {
    try {
      const inputDecimals = TOKEN_DECIMALS[inputMint] || 9;
      // Scale trade amount relative to input mint decimals
      const scaledAmount = Math.floor(baseTradeAmount * Math.pow(10, inputDecimals - 9));

      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${scaledAmount}&slippageBps=50&onlyDirectRoutes=false`;
      const res = await fetch(url, { headers: requestHeaders });
      
      if (!res.ok) {
        const errBody = await res.text();
        console.log(`API error status ${res.status} for pair ${inputMint.slice(0, 4)} -> ${outputMint.slice(0, 4)}: ${errBody}`);
        await sleep(400);
        continue;
      }
      
      const quoteData = await res.json();

      if (quoteData && quoteData.outAmount && quoteData.inAmount) {
        const inAmt = BigInt(quoteData.inAmount);
        const outAmt = BigInt(quoteData.outAmount);
        const estimatedProfit = Number(outAmt - inAmt);

        console.log(`Evaluated pair ${inputMint.slice(0, 4)}... -> ${outputMint.slice(0, 4)}... | Net Spread: ${estimatedProfit} lamports`);

        if (estimatedProfit > maxProfit) {
          maxProfit = estimatedProfit;
          bestOpportunity = { quoteData, inputMint, outputMint, estimatedProfit };
        }
      }
    } catch (err) {
      console.log(`Scan warning on pair: ${err.message}`);
    }
    await sleep(400);
  }

  if (!bestOpportunity || bestOpportunity.estimatedProfit < minProfitThreshold) {
    console.log(`Scan cycle finished. Highest observed spread was ${maxProfit} lamports, failing to clear threshold of ${minProfitThreshold} lamports.`);
    process.exit(0);
  }

  console.log(`Profitable opportunity locked! Executing swap for estimated profit of ${bestOpportunity.estimatedProfit} lamports.`);

  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
    method: 'POST',
    headers: {
      ...requestHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      quoteResponse: bestOpportunity.quoteData,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: false,
      useSharedAccounts: false
    })
  });

  if (!swapRes.ok) {
    const errText = await swapRes.text();
    throw new Error(`Swap instructions generation failed: ${errText}`);
  }

  const instructionsData = await swapRes.json();

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

  const txid = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 2
  });
  console.log(`Arbitrage transaction broadcasted successfully: https://solscan.io/tx/${txid}`);
})().catch((err) => {
  console.error(`Execution error: ${err.stack || err.message}`);
  process.exit(1);
});
