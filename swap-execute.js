import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

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
  const quoteResponse = await fetch(quoteUrl);
  const quoteData = await quoteResponse.json();

  if (!quoteData || quoteData.error || !quoteData.outAmount) {
    console.log('No valid swap route returned from quote API.');
    process.exit(0);
  }

  if (inputMint === outputMint && BigInt(quoteData.outAmount) <= BigInt(tradeAmount)) {
    console.log(`No profitable margin: input ${tradeAmount} lamports, output ${quoteData.outAmount} lamports.`);
    process.exit(0);
  }

  const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
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

  const swapData = await swapResponse.json();
  if (!swapData.swapTransaction) {
    console.error('Failed to assemble swap transaction.');
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
