const { Connection, PublicKey } = require('@solana/web3.js');

const RPC_URL = process.env.SOLANA_RPC_URL;
const WALLET = process.env.DESTINATION_WALLET || process.argv[2];

if (!RPC_URL) {
  console.error('[ERROR] SOLANA_RPC_URL is not set in environment.');
  process.exit(1);
}

if (!WALLET) {
  console.error('[ERROR] Target wallet address missing.');
  process.exit(1);
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const pubkey = new PublicKey(WALLET);

  const balance = await connection.getBalance(pubkey);
  console.log(`[NATIVE BALANCE] ${balance} lamports (${balance / 1e9} SOL)`);

  const tokens = await connection.getParsedTokenAccountsByOwner(pubkey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  });

  tokens.value.forEach((t) => {
    const info = t.account.data.parsed.info;
    console.log(`[TOKEN] Mint: ${info.mint} | Balance: ${info.tokenAmount.uiAmountString}`);
  });
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
});
