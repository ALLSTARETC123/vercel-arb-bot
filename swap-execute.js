import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

async function executeSwap() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  const inputMint = process.env.INPUT_MINT;
  const outputMint = process.env.OUTPUT_MINT;
  const tradeAmount = process.env.TRADE_AMOUNT;

  if (!rpcUrl || !privateKey || !inputMint || !outputMint || !tradeAmount) {
    console.error('Missing required environment configuration.');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

  const balance = await connection.getBalance(wallet.publicKey);
  const RENT_EXEMPTION_LAMPORTS = 2039280;
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  const parsedAccounts = await connection.getParsedTokenAccountsByOwner(
    wallet.publicKey,
    { programId: TOKEN_PROGRAM_ID }
  );

  const openAccounts = new Set([
    'So11111111111111111111111111111111111111112'
  ]);

  for (const acc of parsedAccounts.value) {
    openAccounts.add(acc.account.data.parsed.info.mint);
  }

  if (!openAccounts.has(outputMint) && balance < RENT_EXEMPTION_LAMPORTS) {
    console.log(`Bypassing execution: Target ATA is not initialized and balance (${balance} lamports) cannot cover the ${RENT_EXEMPTION_LAMPORTS} rent fee.`);
    process.exit(0);
  }

  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${tradeAmount}&slippageBps=50&onlyDirectRoutes=true`;
  const quoteResponse = await fetch(quoteUrl);
  const quoteData = await quoteResponse.json();

  if (!quoteData || quoteData.error) {
    console.log('No direct swap route available.');
    process.exit(0);
  }

  const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quoteData,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    })
  });

  const swapData = await swapResponse.json();
  if (!swapData.swapTransaction) {
    console.error('Failed to assemble transaction.');
    process.exit(1);
  }

  const transaction = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
  transaction.sign([wallet]);

  const txid = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 2
  });

  console.log(`Transaction sent: https://solscan.io/tx/${txid}`);
}

executeSwap().catch((err) => {
  console.error(`Swap error: ${err.message}`);
  process.exit(1);
});
