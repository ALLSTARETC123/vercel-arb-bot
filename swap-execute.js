import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

async function run() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  const inputMint = process.env.INPUT_MINT;
  const outputMint = process.env.OUTPUT_MINT;
  const tradeAmount = process.env.TRADE_AMOUNT;
  const minProfitThreshold = Number(process.env.MIN_PROFIT_THRESHOLD || 0);

  if (!rpcUrl || !privateKey || !inputMint || !outputMint || !tradeAmount) {
    console.error("Missing required environment variables.");
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const secretKey = bs58.decode(privateKey);
  const wallet = Keypair.fromSecretKey(secretKey);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`[WALLET CHECK] Address: ${wallet.publicKey.toString()} | Balance: ${balance} lamports`);

  if (balance < Number(tradeAmount)) {
    console.log("[INSUFFICIENT FUNDS] Balance below trade amount.");
    process.exit(0);
  }

  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${tradeAmount}&slippageBps=100`;
  const quoteRes = await fetch(quoteUrl);
  const quoteData = await quoteRes.json();

  if (!quoteData || quoteData.error) {
    console.error("[QUOTE ERROR]", quoteData ? quoteData.error : "Failed to fetch quote");
    process.exit(0);
  }

  const outAmount = Number(quoteData.outAmount || 0);
  const netProfit = outAmount - Number(tradeAmount);

  console.log(`[QUOTE EVALUATED] Net Profit: ${netProfit} lamports`);

  if (netProfit < minProfitThreshold) {
    console.log(`[BELOW THRESHOLD] Net profit ${netProfit} lamports is below threshold.`);
    process.exit(0);
  }

  console.log("[EXECUTING] Threshold met. Sending transaction...");

  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quoteData,
      userPublicKey: wallet.publicKey.toString(),
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    })
  });

  const { swapTransaction } = await swapRes.json();
  if (!swapTransaction) {
    console.error("[SWAP BUILD ERROR] Failed to construct swap transaction.");
    process.exit(0);
  }

  const swapBuf = Buffer.from(swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapBuf);
  transaction.sign([wallet]);

  try {
    const rawTransaction = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 2
    });

    const latestBlockHash = await connection.getLatestBlockhash();
    const confirmation = await connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: txid
    });

    if (confirmation.value.err) {
      const errStr = JSON.stringify(confirmation.value.err);
      if (errStr.includes('"Custom":1') || errStr.includes('Custom": 1')) {
        console.log('[SLIPPAGE EXCEEDED] Trade reverted on-chain due to price movement.');
        process.exit(0);
      }
      console.error(`[EXECUTION ERROR] Transaction failed on-chain: ${errStr}`);
      process.exit(1);
    }

    console.log(`[SUCCESS] Transaction confirmed: ${txid}`);
    process.exit(0);
  } catch (err) {
    const errStr = err.toString();
    if (errStr.includes('"Custom":1') || errStr.includes('Custom": 1')) {
      console.log('[SLIPPAGE EXCEEDED] Trade reverted on-chain due to price movement.');
      process.exit(0);
    }
    console.error(`[EXECUTION ERROR] ${err.message}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
