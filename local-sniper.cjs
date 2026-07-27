const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const { decode } = require('bs58');

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

const INITIAL_LAMPORTS = "10000000"; 
const MIN_PROFIT = 5200;
const POLL_DELAY_MS = 2000;

const ROUTES = [
  { name: "USDC-USDT", tokens: [USDC, USDT] },
  { name: "USDC-BONK", tokens: [USDC, BONK] },
  { name: "USDC-WIF", tokens: [USDC, WIF] }
];

async function getQuote(inp, out, amt) {
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inp}&outputMint=${out}&amount=${amt}&slippageBps=50`;
  const res = await fetch(url);
  return res.ok ? await res.json() : null;
}

(async () => {
  if (!process.env.SOLANA_PRIVATE_KEY) {
    console.log("[Error] SOLANA_PRIVATE_KEY missing.");
    process.exit(1);
  }

  let secretKey;
  try {
    secretKey = Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY));
  } catch {
    secretKey = decode(process.env.SOLANA_PRIVATE_KEY);
  }

  const wallet = Keypair.fromSecretKey(secretKey);
  const connection = new Connection("https://api.mainnet-beta.solana.com");

  console.log(`Starting High-Frequency Sniper on ${ROUTES.length} routes...`);

  while (true) {
    for (const route of ROUTES) {
      try {
        const q1 = await getQuote(SOL, route.tokens[0], INITIAL_LAMPORTS);
        if (!q1) continue;

        const q2 = await getQuote(route.tokens[0], route.tokens[1], q1.outAmount);
        if (!q2) continue;

        const q3 = await getQuote(route.tokens[1], SOL, q2.outAmount);
        if (!q3) continue;

        const profit = parseInt(q3.outAmount) - parseInt(INITIAL_LAMPORTS);
        
        if (profit > MIN_PROFIT) {
          const swapReq = await fetch('https://api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quoteResponse: q3,
              userPublicKey: wallet.publicKey.toString(),
              wrapAndUnwrapSol: true,
              prioritizationFeeLamports: 100
            })
          });

          const { swapTransaction } = await swapReq.json();
          if (swapTransaction) {
            const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
            transaction.sign([wallet]);
            const txid = await connection.sendRawTransaction(transaction.serialize());
            console.log(`[SUCCESS] Transaction: ${txid}`);
          }
        }
      } catch (err) {}
    }
    await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
  }
})();
