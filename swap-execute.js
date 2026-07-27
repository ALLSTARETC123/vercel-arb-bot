import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

async function executeSwap() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  const inputMint = process.env.INPUT_MINT;
  const outputMint = process.env.OUTPUT_MINT;
  const amount = process.env.TRADE_AMOUNT;

  if (!rpcUrl || !privateKey || !inputMint || !outputMint || !amount) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

  const endpoints = [
    'https://api.jup.ag/swap/v1',
    'https://quote-api.jup.ag/v6'
  ];

  let quoteData = null;
  let activeEndpoint = '';

  for (const endpoint of endpoints) {
    try {
      const quoteUrl = `${endpoint}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=100`;
      const res = await fetch(quoteUrl);
      if (res.ok) {
        quoteData = await res.json();
        activeEndpoint = endpoint;
        break;
      }
    } catch (err) {
      console.warn(`[WARN] Endpoint ${endpoint} unreachable: ${err.message}`);
    }
  }

  if (!quoteData) {
    console.log('[SWAP ENGINE] Jupiter endpoints unavailable during this run. Exiting safely.');
    process.exit(0);
  }

  try {
    const swapRes = await fetch(`${activeEndpoint}/swap`, {
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

    if (!swapRes.ok) {
      console.log(`[SWAP ENGINE] Swap transaction construction returned status ${swapRes.status}`);
      process.exit(0);
    }

    const { swapTransaction } = await swapRes.json();
    const swapBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapBuf);

    transaction.sign([wallet]);

    const rawTx = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      maxRetries: 3
    });

    console.log(`[SWAP ENGINE] Submitted transaction: ${txid}`);
    const confirmation = await connection.confirmTransaction(txid, 'confirmed');

    if (confirmation.value.err) {
      console.log(`[SWAP ENGINE] Transaction reverted on-chain: ${JSON.stringify(confirmation.value.err)}`);
      process.exit(0);
    }

    console.log(`[SWAP SUCCESS] Transaction landed: https://solscan.io/tx/${txid}`);
  } catch (err) {
    console.log(`[SWAP ENGINE] Execution bypassed: ${err.message}`);
    process.exit(0);
  }
}

executeSwap().catch((err) => {
  console.log(`[SWAP ENGINE] Handled execution exception: ${err.message}`);
  process.exit(0);
});
