const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const { decode } = require('bs58');

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKSJtanSqYXRcF8fBopzLHYxdM65zcjm";

const INITIAL_LAMPORTS = "100000000"; // 0.1 SOL base input
const MIN_PROFIT_LAMPORTS = 50000;    // Minimum net threshold to cover signature and priority fees
const POLL_DELAY_MS = 1000;

const INTERMEDIATE_TARGETS = [USDC, USDT, BONK, WIF];

async function fetchQuote(inputMint, outputMint, amount) {
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=30&restrictIntermediateTokens=true`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

(async () => {
  if (!process.env.SOLANA_PRIVATE_KEY) {
    console.error("[Error] SOLANA_PRIVATE_KEY environment variable required.");
    process.exit(1);
  }

  let secretKey;
  try {
    secretKey = Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY));
  } catch {
    secretKey = decode(process.env.SOLANA_PRIVATE_KEY);
  }

  const wallet = Keypair.fromSecretKey(secretKey);
  const rpcEndpoint = process.env.SOLANA_RPC_URL || "https://solana-mainnet.g.alchemy.com/v2/hVK0JqgLbPGWwnqTt9DR6";
  const connection = new Connection(rpcEndpoint, "confirmed");

  console.log(`Arbitrage execution engine active. Connected to Alchemy RPC endpoint...`);

  while (true) {
    for (const token of INTERMEDIATE_TARGETS) {
      try {
        // Leg 1: SOL -> Intermediate Token
        const leg1 = await fetchQuote(SOL, token, INITIAL_LAMPORTS);
        if (!leg1 || !leg1.outAmount) continue;

        // Leg 2: Intermediate Token -> SOL (Closed Loop Settlement)
        const leg2 = await fetchQuote(token, SOL, leg1.outAmount);
        if (!leg2 || !leg2.outAmount) continue;

        const outLamports = BigInt(leg2.outAmount);
        const inLamports = BigInt(INITIAL_LAMPORTS);
        const netProfit = outLamports - inLamports;

        if (netProfit > BigInt(MIN_PROFIT_LAMPORTS)) {
          console.log(`Arbitrage spread locked! Estimated net yield: ${netProfit.toString()} lamports`);

          const swapRes = await fetch("https://api.jup.ag/swap/v1/swap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quoteResponse: leg2,
              userPublicKey: wallet.publicKey.toString(),
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: "auto"
            })
          });

          const { swapTransaction } = await swapRes.json();
          if (swapTransaction) {
            const txBuffer = Buffer.from(swapTransaction, "base64");
            const transaction = VersionedTransaction.deserialize(txBuffer);
            transaction.sign([wallet]);

            const txid = await connection.sendRawTransaction(transaction.serialize(), {
              skipPreflight: false,
              maxRetries: 3
            });
            console.log(`[SUCCESS] Arbitrage transaction landed: https://solscan.io/tx/${txid}`);
          }
        }
      } catch (err) {
        console.error(`Route scan execution error: ${err.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
  }
})();
                              
