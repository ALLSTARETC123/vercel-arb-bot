const dns = require("dns");
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder("ipv4first");
const { Connection, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const rpcUrl = process.env.SOLANA_RPC_URL;
const privateKeyEnv = process.env.SOLANA_PRIVATE_KEY;
const inputMint = process.env.INPUT_MINT;
const outputMint = process.env.OUTPUT_MINT;
const tradeAmount = process.env.TRADE_AMOUNT;
const minProfitThreshold = Number(process.env.MIN_PROFIT_THRESHOLD || '0');

if (!rpcUrl || !privateKeyEnv) {
  console.error('[CONFIG ERROR] Missing SOLANA_RPC_URL or SOLANA_PRIVATE_KEY in environment.');
  process.exit(1);
}

if (!inputMint || !outputMint || !tradeAmount) {
  console.error('[CONFIG ERROR] Missing required parameters: INPUT_MINT, OUTPUT_MINT, or TRADE_AMOUNT.');
  process.exit(1);
}

let secretKey;
try {
  const trimmedKey = privateKeyEnv.trim();
  if (trimmedKey.startsWith('[')) {
    secretKey = Uint8Array.from(JSON.parse(trimmedKey));
  } else {
    secretKey = (bs58.decode || bs58.default?.decode)(trimmedKey);
  }
} catch (err) {
  console.error(err.stack);
  if (err.cause) console.error("CAUSE:", JSON.stringify(err.cause));
  console.error('[KEY ERROR] Failed to parse SOLANA_PRIVATE_KEY:', err.message);
  process.exit(1);
}

if (secretKey.length !== 64) {
  console.error(`[KEY ERROR] Invalid key size (${secretKey.length} bytes). Must be exactly 64 bytes.`);
  process.exit(1);
}

const connection = new Connection(rpcUrl, 'confirmed');
const wallet = Keypair.fromSecretKey(secretKey);

async function scanAndExecute() {
  try {
    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${tradeAmount}&slippageBps=50`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });

    if (!res.ok) {
      console.error(`[API ERROR] Jupiter returned HTTP status ${res.status}`);
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
  console.error(error.stack);
  if (error.cause) console.error("CAUSE:", JSON.stringify(error.cause));
    console.error('[EXECUTION ERROR]', error.message);
    return false;
  }
}

scanAndExecute();
