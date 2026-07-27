import { Connection, Keypair, VersionedTransaction, TransactionMessage, PublicKey } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import bs58 from 'bs58';

(async () => {
  console.log('Scan engine initiated...');
  
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

  const wsolMint = 'So11111111111111111111111111111111111111112';
  const inputMint = process.env.INPUT_MINT || wsolMint;
  const outputMint = process.env.OUTPUT_MINT || wsolMint;

  let quoteData;
  try {
    quoteData = await jupiterApi.quoteGet({
      inputMint,
      outputMint,
      amount: Number(tradeAmount),
      slippageBps: 50,
      onlyDirectRoutes: false
    });
  } catch (e) {
    console.log(`Quote scan failed: ${e.message}`);
    process.exit(0);
  }

  if (!quoteData || !quoteData.outAmount || !quoteData.inAmount) {
    console.log('No valid quote route returned by scan engine.');
    process.exit(0);
  }

  const inAmt = BigInt(quoteData.inAmount);
  const outAmt = BigInt(quoteData.outAmount);
  const estimatedProfit = outAmt > inAmt ? Number(outAmt - inAmt) : 0;

  console.log(`Scan result - Input: ${inAmt}, Output: ${outAmt}, Estimated Net: ${estimatedProfit} lamports (Threshold: ${minProfitThreshold})`);

  if (estimatedProfit < minProfitThreshold) {
    console.log('Profit threshold not met. Aborting execution.');
    process.exit(0);
  }

  console.log('Profitable opportunity verified. Fetching instructions...');

  let instructionsData;
  try {
    instructionsData = await jupiterApi.swapInstructionsPost({
      swapRequest: {
        quoteResponse: quoteData,
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

  console.log(`Instructions compiled: ${filteredInstructions.length} active instructions after stripping ATA creation.`);

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
