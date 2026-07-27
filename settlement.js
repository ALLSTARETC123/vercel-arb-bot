const { Connection, Keypair, PublicKey, Transaction, SystemProgram, VersionedTransaction, TransactionMessage } = require("@solana/web3.js");
const bs58Import = require("bs58");
const bs58 = bs58Import.default || bs58Import;

function parsePrivateKey(rawKey) {
  if (!rawKey) throw new Error("SOLANA_PRIVATE_KEY environment variable is missing.");
  let cleaned = rawKey.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  let bytes;
  if (cleaned.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(cleaned));
  } else if (/^[0-9a-fA-F]+$/.test(cleaned) && (cleaned.length === 64 || cleaned.length === 128)) {
    bytes = Uint8Array.from(Buffer.from(cleaned, "hex"));
  } else {
    try {
      bytes = bs58.decode(cleaned);
    } catch (e) {
      bytes = Uint8Array.from(Buffer.from(cleaned, "base64"));
    }
  }
  if (bytes.length === 64) {
    return Keypair.fromSecretKey(bytes);
  } else if (bytes.length === 32) {
    return Keypair.fromSeed(bytes);
  } else {
    throw new Error("Invalid key length: decoded " + bytes.length + " bytes.");
  }
}

async function sendAndConfirmHttp(connection, transaction, signers) {
  try {
    const serialized = transaction.serialize();
    const txid = await connection.sendRawTransaction(serialized, { skipPreflight: false });
    const start = Date.now();
    while (Date.now() - start < 45000) {
      const { value } = await connection.getSignatureStatus(txid);
      if (value && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) {
        if (value.err) throw new Error("Transaction execution failed: " + JSON.stringify(value.err));
        return txid;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("Transaction confirmation timed out for TX: " + txid);
  } catch (err) {
    console.error("[Settlement] sendAndConfirmHttp error:", err.message);
    throw err;
  }
}

async function runSettlement() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });
  const keypair = parsePrivateKey(process.env.SOLANA_PRIVATE_KEY);
  const recipientPubkey = new PublicKey(process.env.DESTINATION_WALLET || "3jDHtWFGUtiqpiJ72tnmoNj5b2HFBGBf8hzR3bdhuPNm");

  const BASE_OPERATIONAL_RESERVE = 2000000;
  const MIN_PROFIT_THRESHOLD = 1000;
  const ESTIMATED_TX_FEE = 5000;

  const balance = await connection.getBalance(keypair.publicKey);
  const netExcess = balance - BASE_OPERATIONAL_RESERVE;

  if (netExcess < (MIN_PROFIT_THRESHOLD + ESTIMATED_TX_FEE)) {
    console.log("[Settlement] Skipping sweep. Wallet balance: " + balance + " lamports. Operational reserve maintained: " + BASE_OPERATIONAL_RESERVE + " lamports. Available profit: " + (netExcess > 0 ? netExcess : 0) + " lamports (Required: " + MIN_PROFIT_THRESHOLD + ").");
    return;
  }

  const sweepAmount = netExcess - ESTIMATED_TX_FEE;
  console.log("[Settlement] Sweeping " + sweepAmount + " lamports profit to " + recipientPubkey.toBase58() + " while retaining " + BASE_OPERATIONAL_RESERVE + " lamports reserve.");

  try {
    const { blockhash } = await connection.getLatestBlockhash();
    
    const instruction = SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientPubkey,
      lamports: sweepAmount,
    });

    const messageV0 = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([keypair]);

    const txid = await sendAndConfirmHttp(connection, tx, [keypair]);
    console.log("[Settlement SUCCESS] Transferred " + sweepAmount + " lamports via HTTP polling. TXID: " + txid);
  } catch (err) {
    console.error("[Settlement] Error during settlement:", err.message);
    throw err;
  }
}

runSettlement().catch((err) => {
  console.error("[Settlement ERROR]", err.message);
  process.exit(1);
});
