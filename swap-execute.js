const { Connection, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const rpcUrl = process.env.SOLANA_RPC_URL;
const privateKeyEnv = process.env.SOLANA_PRIVATE_KEY;

if (!rpcUrl || !privateKeyEnv) {
  console.error('[CONFIG ERROR] Missing SOLANA_RPC_URL or SOLANA_PRIVATE_KEY.');
  process.exit(1);
}

let secretKey;
try {
  const trimmedKey = privateKeyEnv.trim();
  if (trimmedKey.startsWith('[')) {
    secretKey = Uint8Array.from(JSON.parse(trimmedKey));
  } else {
    secretKey = bs58.decode(trimmedKey);
  }
} catch (err) {
  console.error('[KEY ERROR] Failed to parse SOLANA_PRIVATE_KEY:', err.message);
  process.exit(1);
}

if (secretKey.length !== 64) {
  console.error(`[KEY ERROR] Invalid key size (${secretKey.length} bytes). Must be 64 bytes.`);
  process.exit(1);
}

const connection = new Connection(rpcUrl, 'confirmed');
const wallet = Keypair.fromSecretKey(secretKey);

const inputMint = process.env.INPUT_MINT || 'So11111111111111111111111111111111111111112';
const outputMint = process.env.OUTPUT_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const tradeAmount = process.env.TRADE_AMOUNT || '100000000';
const minProfitThreshold = Number(process.env.MIN_PROFIT_THRESHOLD || '500');

async function scanAndExecute() {
  try {
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${tradeAmount}&slippageBps=50`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`[API ERROR] Jupiter returned HTTP ${res.status}`);
      return false;
    }

    const quoteResponse = await res.json();
    if (!quoteResponse || !quoteResponse.outAmount) {
      console.log('[NO ROUTE] No valid liquidity route returned.');
      return false;
    }

    const expectedOut = parseInt(quoteResponse.outAmount, 10);
    const inputAmt = parseInt(tradeAmount, 10);
    const netProfit = expectedOut - inputAmt - 10000;

    if (netProfit < minProfitThreshold) {
      console.log(`[BELOW THRESHOLD] Net profit ${netProfit} lamports is below threshold.`);
      return false;
    }

    console.log(`[PROFIT OPPORTUNITY] Trade viable. Net profit: ${netProfit} lamports`);
    return true;
  } catch (error) {
    console.error('[EXECUTION ERROR]', error.message);
    return false;
  }
}

scanAndExecute();
