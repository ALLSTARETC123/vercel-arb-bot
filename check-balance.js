const { Connection, PublicKey, Keypair } = require('@solana/web3.js');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function decodeBase58(str) {
  let bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const p = ALPHABET.indexOf(str[i]);
    if (p === -1) throw new Error(`Invalid Base58 character at index ${i}`);
    for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
    bytes[0] += p;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

const RPC_URL = process.env.SOLANA_RPC_URL;
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const DEST_WALLET = process.env.DESTINATION_WALLET;

if (!RPC_URL) {
  console.error('[ERROR] SOLANA_RPC_URL secret is missing.');
  process.exit(1);
}

async function main() {
  let pubkey;
  if (DEST_WALLET && DEST_WALLET.trim().length > 0) {
    pubkey = new PublicKey(DEST_WALLET.trim());
  } else if (PRIVATE_KEY && PRIVATE_KEY.trim().length > 0) {
    const trimmed = PRIVATE_KEY.trim();
    const secret = trimmed.startsWith('[')
      ? Uint8Array.from(JSON.parse(trimmed))
      : decodeBase58(trimmed);
    pubkey = Keypair.fromSecretKey(secret).publicKey;
  } else {
    console.error('[ERROR] Neither DESTINATION_WALLET nor SOLANA_PRIVATE_KEY is present in secrets.');
    process.exit(1);
  }

  console.log(`[TARGET WALLET] ${pubkey.toBase58()}`);
  const connection = new Connection(RPC_URL, 'confirmed');

  const balance = await connection.getBalance(pubkey);
  console.log(`[NATIVE BALANCE] ${balance} lamports (${balance / 1e9} SOL)`);

  const tokens = await connection.getParsedTokenAccountsByOwner(pubkey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  });

  if (tokens.value.length === 0) {
    console.log('[TOKENS] No SPL token accounts found.');
  } else {
    tokens.value.forEach((t) => {
      const info = t.account.data.parsed.info;
      console.log(`[TOKEN] ${info.mint} | Balance: ${info.tokenAmount.uiAmountString}`);
    });
  }
}

main().catch((err) => {
  console.error(`[EXECUTION FAILED] ${err.message}`);
  process.exit(1);
});
