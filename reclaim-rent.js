import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

async function reclaimRent() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.error('Missing SOLANA_RPC_URL or SOLANA_PRIVATE_KEY.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  console.log(`Checking empty token accounts for wallet: ${wallet.publicKey.toString()}`);

  const parsedAccounts = await connection.getParsedTokenAccountsByOwner(
    wallet.publicKey,
    { programId: TOKEN_PROGRAM_ID }
  );

  const emptyAccounts = parsedAccounts.value.filter(accountInfo => {
    const amount = accountInfo.account.data.parsed.info.tokenAmount.uiAmount;
    return amount === 0;
  });

  if (emptyAccounts.length === 0) {
    console.log('No empty token accounts found to reclaim rent from.');
    process.exit(0);
  }

  console.log(`Found ${emptyAccounts.length} empty token account(s). Reclaiming rent...`);

  const tx = new Transaction();

  for (const acc of emptyAccounts) {
    const tokenAccountPubKey = acc.pubkey;
    
    // SPL Token CloseAccount instruction layout: index 9
    const keys = [
      { pubkey: tokenAccountPubKey, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false }
    ];

    const instruction = new TransactionInstruction({
      keys,
      programId: TOKEN_PROGRAM_ID,
      data: Buffer.from([9])
    });

    tx.add(instruction);
  }

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);

  const txid = await connection.sendRawTransaction(tx.serialize());
  console.log(`Reclaim transaction submitted: ${txid}`);
  
  await connection.confirmTransaction(txid, 'confirmed');
  console.log(`Successfully reclaimed rent from ${emptyAccounts.length} account(s).`);
}

reclaimRent().catch((err) => {
  console.error(`Reclaim failed: ${err.message}`);
  process.exit(1);
});
