const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

async function fetchJupiterQuote(inputMint, outputMint, amount, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json();
    return data && data.outAmount ? data : null;
  } catch (err) {
    clearTimeout(timeoutId);
    return null;
  }
}

export default async function handler(req, res) {
  const tradeAmount = process.env.TRADE_AMOUNT || "100000000";
  const minProfitThreshold = Number(process.env.MIN_PROFIT_THRESHOLD || 100000);

  // Leg 1: SOL -> USDC
  const leg1 = await fetchJupiterQuote(SOL, USDC, tradeAmount);
  if (!leg1) {
    return res.status(502).json({ 
      error: "Leg 1 (SOL->USDC) quote failed", 
      timestamp: new Date().toISOString() 
    });
  }

  // Leg 2: USDC -> USDT (chained from exact Leg 1 output)
  const leg2 = await fetchJupiterQuote(USDC, USDT, leg1.outAmount);
  if (!leg2) {
    return res.status(502).json({ 
      error: "Leg 2 (USDC->USDT) quote failed", 
      timestamp: new Date().toISOString() 
    });
  }

  // Leg 3: USDT -> SOL (chained from exact Leg 2 output to close loop)
  const leg3 = await fetchJupiterQuote(USDT, SOL, leg2.outAmount);
  if (!leg3) {
    return res.status(502).json({ 
      error: "Leg 3 (USDT->SOL) quote failed", 
      timestamp: new Date().toISOString() 
    });
  }

  const initialLamports = BigInt(tradeAmount);
  const finalLamports = BigInt(leg3.outAmount);
  const netProfitLamports = finalLamports - initialLamports;
  const profitNumber = Number(netProfitLamports);

  const isExecutable = profitNumber >= minProfitThreshold;

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    topology: "Closed-Loop Triangular (SOL -> USDC -> USDT -> SOL)",
    inputAmountLamports: tradeAmount,
    outputAmountLamports: leg3.outAmount,
    netProfitLamports: profitNumber.toString(),
    isExecutable,
    routes: {
      leg1Out: leg1.outAmount,
      leg2Out: leg2.outAmount,
      leg3Out: leg3.outAmount
    }
  });
                                }
        
