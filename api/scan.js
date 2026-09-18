const SOL_MINT = process.env.SOL_MINT || "So11111111111111111111111111111111111111112";
const USDC_MINT = process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = process.env.USDT_MINT || "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

async function fetchJupiterQuote(inputMint, outputMint, amount, slippageBps, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString()
    });

    const headers = {};
    if (process.env.JUPITER_API_KEY) {
      headers["x-api-key"] = process.env.JUPITER_API_KEY;
    }

    const response = await fetch(`https://api.jup.ag/swap/v1/quote?${queryParams}`, {
      signal: controller.signal,
      headers
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json();
    return data && data.outAmount ? data : null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export default async function handler(req, res) {
  const rawTradeAmount = process.env.TRADE_AMOUNT || "100000000";
  const rawMinProfit = process.env.MIN_PROFIT_THRESHOLD || "100000";
  const rawSlippage = process.env.SLIPPAGE_BPS || "50";
  const rawEstimatedFees = process.env.ESTIMATED_FEE_LAMPORTS || "15000";

  let tradeAmount, minProfitThreshold, slippageBps, estimatedFees;

  try {
    tradeAmount = BigInt(rawTradeAmount);
    minProfitThreshold = BigInt(rawMinProfit);
    slippageBps = parseInt(rawSlippage, 10);
    estimatedFees = BigInt(rawEstimatedFees);
  } catch {
    return res.status(400).json({
      error: "Invalid numeric configuration in environment variables",
      timestamp: new Date().toISOString()
    });
  }

  // Leg 1: SOL -> USDC
  const leg1 = await fetchJupiterQuote(SOL_MINT, USDC_MINT, tradeAmount, slippageBps);
  if (!leg1) {
    return res.status(502).json({
      error: "Leg 1 (SOL->USDC) quote failed",
      timestamp: new Date().toISOString()
    });
  }

  // Leg 2: USDC -> USDT
  const leg2 = await fetchJupiterQuote(USDC_MINT, USDT_MINT, leg1.outAmount, slippageBps);
  if (!leg2) {
    return res.status(502).json({
      error: "Leg 2 (USDC->USDT) quote failed",
      timestamp: new Date().toISOString()
    });
  }

  // Leg 3: USDT -> SOL
  const leg3 = await fetchJupiterQuote(USDT_MINT, SOL_MINT, leg2.outAmount, slippageBps);
  if (!leg3) {
    return res.status(502).json({
      error: "Leg 3 (USDT->SOL) quote failed",
      timestamp: new Date().toISOString()
    });
  }

  const finalLamports = BigInt(leg3.outAmount);
  const grossProfitLamports = finalLamports - tradeAmount;
  const netProfitLamports = grossProfitLamports - estimatedFees;

  const isExecutable = netProfitLamports >= minProfitThreshold;

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    topology: "Closed-Loop Triangular (SOL -> USDC -> USDT -> SOL)",
    inputAmountLamports: tradeAmount.toString(),
    outputAmountLamports: leg3.outAmount,
    grossProfitLamports: grossProfitLamports.toString(),
    estimatedFeesLamports: estimatedFees.toString(),
    netProfitLamports: netProfitLamports.toString(),
    isExecutable,
    routes: {
      leg1Out: leg1.outAmount,
      leg2Out: leg2.outAmount,
      leg3Out: leg3.outAmount
    }
  });
  }
    
