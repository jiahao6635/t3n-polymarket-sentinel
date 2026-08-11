export type GammaMarket = {
  slug?: string;
  question: string;
  outcomes: string | string[];
  outcomePrices: string | string[];
  liquidity?: string | number;
  volume24hr?: string | number;
  spread?: string | number;
  bestBid?: string | number;
  bestAsk?: string | number;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  updatedAt?: string;
};

export type NormalizedMarket = {
  question: string;
  outcomes: string[];
  prices: number[];
  liquidity_usd: number;
  volume_24h_usd: number;
  spread: number;
};

export type WarningCode =
  | "thin_liquidity"
  | "very_low_24h_volume"
  | "wide_spread"
  | "price_sum_off_one";

export type MarketAnalysis = {
  normalized_prices: number[];
  dominant_outcome: string;
  dominant_probability: number;
  liquidity_tier: "deep" | "medium" | "thin";
  quality_score: number;
  metrics: {
    price_sum: number;
    sum_deviation_bps: number;
    spread_bps: number;
    liquidity_usd: number;
    volume_24h_usd: number;
    activity_ratio_bps: number;
  };
  warnings: WarningCode[];
};

export async function fetchMarket(marketSlug: string): Promise<GammaMarket> {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("slug", marketSlug);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma request failed: HTTP ${response.status}`);
  }
  const markets = (await response.json()) as GammaMarket[];
  if (!markets[0]) {
    throw new Error(`No Polymarket market found for slug: ${marketSlug}`);
  }
  return markets[0];
}

export function normalizeMarket(market: GammaMarket): NormalizedMarket {
  const outcomes = parseStringArray(market.outcomes, "outcomes");
  const priceStrings = parseStringArray(market.outcomePrices, "outcomePrices");
  const prices = priceStrings.map((value) => parseFiniteNumber(value, "price"));

  const normalized = {
    question: market.question,
    outcomes,
    prices,
    liquidity_usd: parseFiniteNumber(market.liquidity ?? 0, "liquidity"),
    volume_24h_usd: parseFiniteNumber(market.volume24hr ?? 0, "volume24hr"),
    spread: parseFiniteNumber(market.spread ?? 0, "spread"),
  };
  validateNormalizedMarket(normalized);
  return normalized;
}

// Keep these thresholds in sync with src/analysis.rs. The report command uses
// the same deterministic market-quality model without requiring a wallet,
// Terminal 3 credentials, or a contract invocation.
export function analyzeNormalizedMarket(market: NormalizedMarket): MarketAnalysis {
  validateNormalizedMarket(market);
  const priceSum = market.prices.reduce((sum, price) => sum + price, 0);
  if (priceSum <= Number.EPSILON) {
    throw new Error("prices must have a positive sum");
  }

  const normalizedPrices = market.prices.map((price) => roundTo(price / priceSum, 6));
  const dominantIndex = normalizedPrices.reduce(
    (best, value, index) => (value > normalizedPrices[best]! ? index : best),
    0,
  );
  const sumDeviationBps = toBps(Math.abs(priceSum - 1));
  const spreadBps = toBps(market.spread);
  const activityRatioBps =
    market.liquidity_usd <= Number.EPSILON
      ? 0
      : clampInteger(Math.round((market.volume_24h_usd / market.liquidity_usd) * 10_000));

  const liquidityTier =
    market.liquidity_usd >= 100_000
      ? "deep"
      : market.liquidity_usd >= 10_000
        ? "medium"
        : "thin";

  const warnings: WarningCode[] = [];
  if (market.liquidity_usd < 1_000) warnings.push("thin_liquidity");
  if (market.volume_24h_usd < 100) warnings.push("very_low_24h_volume");
  if (spreadBps > 300) warnings.push("wide_spread");
  if (sumDeviationBps > 200) warnings.push("price_sum_off_one");

  return {
    normalized_prices: normalizedPrices,
    dominant_outcome: market.outcomes[dominantIndex]!.trim(),
    dominant_probability: roundTo(market.prices[dominantIndex]! / priceSum, 6),
    liquidity_tier: liquidityTier,
    quality_score: qualityScore(
      market.liquidity_usd,
      market.volume_24h_usd,
      spreadBps,
      sumDeviationBps,
    ),
    metrics: {
      price_sum: roundTo(priceSum, 6),
      sum_deviation_bps: sumDeviationBps,
      spread_bps: spreadBps,
      liquidity_usd: roundTo(market.liquidity_usd, 2),
      volume_24h_usd: roundTo(market.volume_24h_usd, 2),
      activity_ratio_bps: activityRatioBps,
    },
    warnings,
  };
}

function validateNormalizedMarket(market: NormalizedMarket): void {
  if (market.question.trim().length < 1 || market.question.length > 500) {
    throw new Error("question must contain 1-500 characters");
  }
  if (market.outcomes.length < 2 || market.outcomes.length > 8) {
    throw new Error("outcomes must contain 2-8 labels");
  }
  if (market.outcomes.length !== market.prices.length) {
    throw new Error("outcomes and prices must have equal length");
  }
  if (market.outcomes.some((outcome) => outcome.trim().length === 0)) {
    throw new Error("outcome labels cannot be empty");
  }
  if (market.prices.some((price) => !Number.isFinite(price) || price < 0 || price > 1)) {
    throw new Error("every price must be finite and between 0 and 1");
  }
  if (!Number.isFinite(market.liquidity_usd) || market.liquidity_usd < 0) {
    throw new Error("liquidity_usd must be finite and non-negative");
  }
  if (!Number.isFinite(market.volume_24h_usd) || market.volume_24h_usd < 0) {
    throw new Error("volume_24h_usd must be finite and non-negative");
  }
  if (!Number.isFinite(market.spread) || market.spread < 0 || market.spread > 1) {
    throw new Error("spread must be finite and between 0 and 1");
  }
}

function qualityScore(
  liquidityUsd: number,
  volume24hUsd: number,
  spreadBps: number,
  sumDeviationBps: number,
): number {
  let score = 100;
  score -= liquidityUsd < 1_000 ? 35 : liquidityUsd < 10_000 ? 15 : 0;
  score -= volume24hUsd < 100 ? 10 : 0;
  score -= spreadBps > 1_000 ? 40 : spreadBps > 500 ? 30 : spreadBps > 200 ? 15 : 0;
  score -= sumDeviationBps > 500 ? 25 : sumDeviationBps > 200 ? 10 : 0;
  return Math.min(100, Math.max(0, score));
}

function parseStringArray(raw: string | string[], field: string): string[] {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} is not a string array`);
  }
  return value;
}

function parseFiniteNumber(raw: string | number, field: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${field} is not a finite number`);
  }
  return value;
}

function toBps(value: number): number {
  return clampInteger(Math.round(value * 10_000));
}

function clampInteger(value: number): number {
  return Math.min(0xffff_ffff, Math.max(0, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
