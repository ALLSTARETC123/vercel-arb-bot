const { 
  Connection, 
  Keypair, 
  PublicKey, 
  VersionedTransaction, 
  TransactionMessage, 
  SystemProgram,
  ComputeBudgetProgram
} = require('@solana/web3.js');
const bs58Import = require('bs58');
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

async function sendAndConfirmWithRetry(connection, transaction, signers, lastValidBlockHeight) {
  transaction.sign(signers);
  const rawTx = transaction.serialize();
  const txid = await connection.sendRawTransaction(rawTx, { skipPreflight: false });

  while (true) {
    const currentBlockHeight = await connection.getBlockHeight('confirmed');
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error(`Transaction expired. Current block height (${currentBlockHeight}) exceeded target limit (${lastValidBlockHeight}).`);
    }

    const { value } = await connection.getSignatureStatus(txid);
    if (value && (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized')) {
      if (value.err) throw new Error("Transaction execution failed: " + JSON.stringify(value.err));
      return txid;
    }

    await connection.sendRawTransaction(rawTx, { skipPreflight: true });
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function runSettlement() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://solana-mainnet.g.alchemy.com/v2/hVK0JqgLbPGWwnqTt9DR6";
  const connection = new Connection(rpcUrl, 'confirmed');
  const keypair = parsePrivateKey(process.env.SOLANA_PRIVATE_KEY);
  const recipientPubkey = new PublicKey(process.env.DESTINATION_WALLET || "3jDHtWFGUtiqpiJ72tnmoNj5b2HFBGBf8hzR3bdhuPNm");

  const BASE_OPERATIONAL_RESERVE = 50000000; // 0.05 SOL reserve for rent/fees
  const MIN_PROFIT_THRESHOLD = Number(process.env.MIN_PROFIT_THRESHOLD || 100000);
  const PRIORITY_FEE_MICRO_LAMPORTS = 50000;
  const ESTIMATED_TX_FEE = 10000;

  const balance = await connection.getBalance(keypair.publicKey);
  const netExcess = balance - BASE_OPERATIONAL_RESERVE;

  if (netExcess < (MIN_PROFIT_THRESHOLD + ESTIMATED_TX_FEE)) {
    console.log(`[Settlement] Skipping sweep. Wallet balance: ${balance} lamports. Reserve maintained: ${BASE_OPERATIONAL_RESERVE} lamports. Available yield: ${netExcess > 0 ? netExcess : 0} lamports.`);
    return;
  }

  const sweepAmount = netExcess - ESTIMATED_TX_FEE;
  console.log(`[Settlement] Sweeping ${sweepAmount} lamports profit to ${recipientPubkey.toBase58()} while retaining ${BASE_OPERATIONAL_RESERVE} lamports reserve.`);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }),
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientPubkey,
      lamports: sweepAmount,
    })
  ];

  const messageV0 = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);

  const txid = await sendAndConfirmWithRetry(connection, transaction, [keypair], lastValidBlockHeight);
  console.log(`[Settlement SUCCESS] Transferred ${sweepAmount} lamports. TXID: https://solscan.io/tx/${txid}`);
}

runSettlement().catch((err) => {
  console.error("[Settlement ERROR]", err.message);
  process.exit(1);
});
      
