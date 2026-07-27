import { Connection, Keypair, VersionedTransaction, TransactionMessage, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

async function fetchWithRetry(url, options = {}, retries = 3) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json',
    ...(options.headers || {})
  };
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, headers });
      if (res.ok) return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed to reach endpoint ${url}`);
}

(async () => {
  console.log('Engine started...');
  
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  const tradeAmount = process.env.TRADE_AMOUNT;

  if (!rpcUrl || !privateKey || !tradeAmount) {
    console.error('Missing required environment configuration.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

  const wsolMint = 'So11111111111111111111111111111111111111112';
  const inputMint = process.env.INPUT_MINT || wsolMint;
  const outputMint = process.env.OUTPUT_MINT || wsolMint;

  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${tradeAmount}&slippageBps=50&onlyDirectRoutes=true`;

  let quoteData;
  try {
    const quoteResponse = await fetchWithRetry(quoteUrl);
    quoteData = await quoteResponse.json();
  } catch (e) {
    console.log(`Quote request failed: ${e.message}`);
    process.exit(0);
  }

  if (!quoteData || quoteData.error || !quoteData.outAmount) {
    console.log('No direct route returned.');
    process.exit(0);
  }

  let instructionsData;
  try {
    const instResponse = await fetchWithRetry('https://quote-api.jup.ag/v6/instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: false,
        useSharedAccounts: false
      })
    });
    instructionsData = await instResponse.json();
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

  console.log(`Instructions filtered: ${filteredInstructions.length} remain after stripping ATA creation.`);

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
    console.log(`Transaction sent: https://solscan.io/tx/${txid}`);
  } catch (err) {
    console.log(`Execution failed on-chain: ${err.message}`);
    process.exit(0);
  }
})().catch((err) => {
  console.error(`Fatal script error: ${err.stack || err.message}`);
  process.exit(1);
});
