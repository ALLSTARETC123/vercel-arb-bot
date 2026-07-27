import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.SOLANA_RPC_URL;
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const INPUT_MINT = process.env.INPUT_MINT;
const OUTPUT_MINT = process.env.OUTPUT_MINT;
const TRADE_AMOUNT = parseInt(process.env.TRADE_AMOUNT, 10);
const MIN_PROFIT_THRESHOLD = parseInt(process.env.MIN_PROFIT_THRESHOLD, 10);

const connection = new Connection(RPC_URL, 'confirmed');
const secretKey = bs58.decode(PRIVATE_KEY);
const wallet = Keypair.fromSecretKey(secretKey);

async function fetchQuote(input, output, amount) {
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=50`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Quote API status ${res.status}`);
  return await res.json();
}

async function getRoundTripQuote() {
  if (INPUT_MINT === OUTPUT_MINT) {
    const quote = await fetchQuote(INPUT_MINT, OUTPUT_MINT, TRADE_AMOUNT);
    const netProfit = parseInt(quote.outAmount, 10) - parseInt(quote.inAmount, 10);
    return { quote, netProfit };
  }

  const leg1 = await fetchQuote(INPUT_MINT, OUTPUT_MINT, TRADE_AMOUNT);
  const leg2 = await fetchQuote(OUTPUT_MINT, INPUT_MINT, leg1.outAmount);
  const netProfit = parseInt(leg2.outAmount, 10) - TRADE_AMOUNT;
  return { quote: leg1, netProfit };
}

async function executeSwap(quoteResponse) {
  const res = await fetch('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    })
  });

  const { swapTransaction } = await res.json();
  const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([wallet]);

  const rawTransaction = transaction.serialize();
  const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    maxRetries: 2
  });

  const latestBlockHash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    blockhash: latestBlockHash.blockhash,
    lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    signature: txid
  });
  return txid;
}

async function runEngine() {
  try {
    const { quote, netProfit } = await getRoundTripQuote();
    console.log(`[QUOTE EVALUATED] Net Profit: ${netProfit} lamports`);

    if (netProfit >= MIN_PROFIT_THRESHOLD) {
      console.log(`[EXECUTING] Threshold met. Sending transaction...`);
      const txid = await executeSwap(quote);
      console.log(`[SUCCESS] TX: https://solscan.io/tx/${txid}`);
    } else {
      console.log(`[BELOW THRESHOLD] Net profit ${netProfit} lamports is below threshold ${MIN_PROFIT_THRESHOLD}.`);
    }
  } catch (err) {
    console.error(`[EXECUTION ERROR] ${err.message}`);
  }
}

runEngine();
