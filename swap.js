const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const INITIAL_LAMPORTS = "10000000";
const MIN_PROFIT = 1000;

async function getQuote(inp, out, amt) {
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inp}&outputMint=${out}&amount=${amt}&slippageBps=50`;
  const res = await fetch(url);
  return res.ok ? await res.json() : null;
}

async function executeSwap(wallet, connection, inp, out, amt, legName) {
  const quote = await getQuote(inp, out, amt);
  if (!quote) { console.log(`[Error] ${legName} quote failed.`); return null; }
  const swapReq = await fetch('https://api.jup.ag/swap/v1/swap', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({quoteResponse: quote, userPublicKey: wallet.publicKey.toString(), wrapAndUnwrapSol: true, prioritizationFeeLamports: 100})});
  const swapData = await swapReq.json();
  if (!swapData.swapTransaction) { console.log(`[Error] ${legName} swap build failed.`); return null; }
  const transaction = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
  transaction.sign([wallet]);
  const txid = await connection.sendRawTransaction(transaction.serialize());
  console.log(`${legName} submitted: https://solscan.io/tx/${txid}`);
  await new Promise(r => setTimeout(r, 3000));
  return txid;
}

(async () => {
  if (!process.env.SOLANA_PRIVATE_KEY) { console.log("[Error] SOLANA_PRIVATE_KEY missing."); process.exit(1); }
  let secretKey;
  try { secretKey = Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY)); } catch { secretKey = bs58.decode(process.env.SOLANA_PRIVATE_KEY); }
  const wallet = Keypair.fromSecretKey(secretKey);
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  
  const q1 = await getQuote(SOL, USDC, INITIAL_LAMPORTS);
  if (!q1) return console.log("[Error] Initial quote failed.");
  const q2 = await getQuote(USDC, USDT, q1.outAmount);
  if (!q2) return console.log("[Error] Path validation failed.");
  const q3 = await getQuote(USDT, SOL, q2.outAmount);
  if (!q3) return console.log("[Error] Closure failed.");
  
  const profit = parseInt(q3.outAmount) - parseInt(INITIAL_LAMPORTS);
  console.log(`Net Profit: ${profit} lamports`);
  
  if (profit > MIN_PROFIT) {
    console.log('EXECUTE: Starting 3-leg arbitrage...');
    const tx1 = await executeSwap(wallet, connection, SOL, USDC, INITIAL_LAMPORTS, 'Leg 1: SOL→USDC');
    if (!tx1) return console.log("[Error] Leg 1 failed.");
    const tx2 = await executeSwap(wallet, connection, USDC, USDT, q1.outAmount, 'Leg 2: USDC→USDT');
    if (!tx2) return console.log("[Error] Leg 2 failed.");
    const tx3 = await executeSwap(wallet, connection, USDT, SOL, q2.outAmount, 'Leg 3: USDT→SOL');
    if (!tx3) return console.log("[Error] Leg 3 failed.");
    console.log(`[SUCCESS] Arbitrage complete. Profit: ${profit} lamports`);
  } else {
    console.log(`Aborted: Profit ${profit} does not cover ${MIN_PROFIT} threshold.`);
  }
})();
