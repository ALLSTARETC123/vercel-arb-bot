const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require("@solana/web3.js");
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

async function runSettlement() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const keypair = parsePrivateKey(process.env.SOLANA_PRIVATE_KEY);
  const recipientPubkey = new PublicKey(process.env.DESTINATION_WALLET || "3jDHtWFGUtiqpiJ72tnmoNj5b2HFBGBf8hzR3bdhuPNm");

  const BASE_OPERATIONAL_RESERVE = 2000000; // 0.002 SOL gas reserve
  const MIN_PROFIT_THRESHOLD = 1000; // Minimum required profit in lamports
  const ESTIMATED_TX_FEE = 5000; // Transaction fee for native transfer

  const balance = await connection.getBalance(keypair.publicKey);
  const netExcess = balance - BASE_OPERATIONAL_RESERVE;

  if (netExcess < (MIN_PROFIT_THRESHOLD + ESTIMATED_TX_FEE)) {
    console.log("[Settlement] Skipping sweep. Wallet balance: " + balance + " lamports. Operational reserve maintained: " + BASE_OPERATIONAL_RESERVE + " lamports. Available profit: " + (netExcess > 0 ? netExcess : 0) + " lamports (Required: " + MIN_PROFIT_THRESHOLD + ").");
    return;
  }

  const sweepAmount = netExcess - ESTIMATED_TX_FEE;
  console.log("[Settlement] Sweeping " + sweepAmount + " lamports profit to " + recipientPubkey.toBase58() + " while retaining " + BASE_OPERATIONAL_RESERVE + " lamports reserve.");

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientPubkey,
      lamports: sweepAmount,
    })
  );

  const txid = await sendAndConfirmTransaction(connection, transaction, [keypair]);
  console.log("[Settlement SUCCESS] Transferred " + sweepAmount + " lamports. TXID: " + txid);
}

runSettlement().catch((err) => {
  console.error("[Settlement ERROR]", err.message);
  process.exit(1);
});
