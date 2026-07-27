import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
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

async function executeSwap() {
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

  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${tradeAmount}&slippageBps=50`;

  let quoteData;
  try {
    const quoteResponse = await fetchWithRetry(quoteUrl);
    quoteData = await quoteResponse.json();
  } catch (e) {
    console.log(`Quote request failed: ${e.message}`);
    process.exit(0);
  }

  if (!quoteData || quoteData.error || !quoteData.outAmount) {
    console.log('No valid route returned.');
    process.exit(0);
  }

  if (inputMint === outputMint && BigInt(quoteData.outAmount) <= BigInt(tradeAmount)) {
    console.log(`No profit margin: input ${tradeAmount}, output ${quoteData.outAmount}.`);
    process.exit(0);
  }

  let swapData;
  try {
    const swapResponse = await fetchWithRetry('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      })
    });
    swapData = await swapResponse.json();
  } catch (e) {
    console.log(`Swap generation failed: ${e.message}`);
    process.exit(0);
  }

  if (!swapData.swapTransaction) {
    console.error('Failed to construct transaction.');
    process.exit(1);
  }

  const transaction = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
  transaction.sign([wallet]);

  const txid = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 2
  });

  console.log(`Transaction sent: https://solscan.io/tx/${txid}`);
}

executeSwap().catch((err) => {
  console.error(`Swap error: ${err.message}`);
  process.exit(1);
});
