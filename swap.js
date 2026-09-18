const { 
  Connection, 
  Keypair, 
  VersionedTransaction, 
  TransactionMessage, 
  SystemProgram, 
  PublicKey 
} = require('@solana/web3.js');
const bs58 = require('bs58');

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const INITIAL_LAMPORTS = process.env.TRADE_AMOUNT || "100000000"; // 0.1 SOL base
const MIN_PROFIT = Number(process.env.MIN_PROFIT_THRESHOLD || 100000); // 100k lamports
const SETTLEMENT_WALLET = process.env.DESTINATION_WALLET || "3jDHtWFGUtiqpiJ72tnmoNj5b2HFBGBf8hzR3bdhuPNm";
const RESERVE_LAMPORTS = 50000000; // 0.05 SOL gas/rent reserve

async function getQuote(inp, out, amt) {
  try {
    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inp}&outputMint=${out}&amount=${amt}&slippageBps=50`;
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch (err) {
    console.error(`[Quote Error] ${err.message}`);
    return null;
  }
}

async function executeSwap(wallet, connection, inp, out, amt, legName) {
  const quote = await getQuote(inp, out, amt);
  if (!quote) { 
    console.log(`[Error] ${legName} quote failed.`); 
    return null; 
  }

  try {
    const swapReq = await fetch('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto"
      })
    });

    const swapData = await swapReq.json();
    if (!swapData.swapTransaction) { 
      console.log(`[Error] ${legName} swap build failed.`); 
      return null; 
    }

    const transaction = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
    transaction.sign([wallet]);

    const txid = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });
    console.log(`${legName} submitted: https://solscan.io/tx/${txid}`);
    
    await new Promise(r => setTimeout(r, 2500));
    return { txid, outAmount: quote.outAmount };
  } catch (err) {
    console.error(`[Execution Error] ${legName}: ${err.message}`);
    return null;
  }
}

async function settleProfit(wallet, connection) {
  try {
    console.log(`[Settlement] Evaluating balance for wallet: ${wallet.publicKey.toString()}`);
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`[Settlement] Executor balance: ${balance} lamports`);
    
    // Protect base trade capital and minimum gas reserve
    const keepReserve = Number(INITIAL_LAMPORTS) + RESERVE_LAMPORTS;
    if (balance <= keepReserve) {
      console.log(`[Settlement] Balance (${balance} lamports) below reserve threshold (${keepReserve} lamports). Skipping transfer.`);
      return null;
    }
    
    const transferAmount = balance - keepReserve;
    console.log(`[Settlement] Transferring net profit: ${transferAmount} lamports to ${SETTLEMENT_WALLET}`);
    
    const recipientPubkey = new PublicKey(SETTLEMENT_WALLET);
    const instruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipientPubkey,
      lamports: transferAmount,
    });
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();
    
    const tx = new VersionedTransaction(messageV0);
    tx.sign([wallet]);
    
    const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    console.log(`[Settlement] TX submitted: https://solscan.io/tx/${txid}`);
    
    const confirmation = await connection.confirmTransaction({
      signature: txid,
      blockhash,
      lastValidBlockHeight
    }, 'confirmed');

    if (confirmation.value.err) {
      console.log(`[Settlement ERROR] TX failed: ${JSON.stringify(confirmation.value.err)}`);
      return null;
    }
    
    console.log(`[Settlement SUCCESS] ${transferAmount} lamports transferred to ${SETTLEMENT_WALLET}`);
    return txid;
  } catch (e) {
    console.log(`[Settlement EXCEPTION] ${e.message}`);
    return null;
  }
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
    secretKey = bs58.decode(process.env.SOLANA_PRIVATE_KEY); 
  }

  const wallet = Keypair.fromSecretKey(secretKey);
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://solana-mainnet.g.alchemy.com/v2/hVK0JqgLbPGWwnqTt9DR6";
  const connection = new Connection(rpcUrl, 'confirmed');

  const q1 = await getQuote(SOL, USDC, INITIAL_LAMPORTS);
  if (!q1) return console.log("[Error] Initial quote failed.");
  const q2 = await getQuote(USDC, USDT, q1.outAmount);
  if (!q2) return console.log("[Error] Path validation failed.");
  const q3 = await getQuote(USDT, SOL, q2.outAmount);
  if (!q3) return console.log("[Error] Closure failed.");
  
  const profit = parseInt(q3.outAmount) - parseInt(INITIAL_LAMPORTS);
  console.log(`Evaluated Spread: ${profit} lamports`);
  
  if (profit > MIN_PROFIT) {
    console.log('EXECUTE: Starting 3-leg arbitrage sequence...');
    
    const res1 = await executeSwap(wallet, connection, SOL, USDC, INITIAL_LAMPORTS, 'Leg 1: SOL→USDC');
    if (!res1) return console.log("[Error] Leg 1 failed. Aborting sequence.");
    
    // Pass actual received output from Leg 1 to prevent slippage balance errors
    const res2 = await executeSwap(wallet, connection, USDC, USDT, res1.outAmount, 'Leg 2: USDC→USDT');
    if (!res2) return console.log("[Error] Leg 2 failed. Manual swap required for USDC balance.");
    
    // Pass actual received output from Leg 2
    const res3 = await executeSwap(wallet, connection, USDT, SOL, res2.outAmount, 'Leg 3: USDT→SOL');
    if (!res3) return console.log("[Error] Leg 3 failed. Manual swap required for USDT balance.");
    
    console.log(`[SUCCESS] Arbitrage completed successfully.`);
    await settleProfit(wallet, connection);
  } else {
    console.log(`Aborted: Net spread of ${profit} lamports does not meet ${MIN_PROFIT} threshold.`);
  }
})().catch((err) => {
  console.error(`Runtime Execution Error: ${err.stack || err.message}`);
  process.exit(1);
});
      
