import assert from "node:assert/strict";
import test from "node:test";
import { analyzeNormalizedMarket, normalizeMarket } from "./market.js";
import {
  buildMarketReport,
  renderCsv,
  renderMarkdown,
  type ClientReport,
} from "./report.js";

test("normalizes Gamma strings and matches the Rust high-quality score", () => {
  const normalized = normalizeMarket({
    question: "Will the sample event resolve Yes?",
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.42", "0.58"]',
    liquidity: "125000",
    volume24hr: 18000,
    spread: 0.006,
  });
  const analysis = analyzeNormalizedMarket(normalized);

  assert.deepEqual(normalized.outcomes, ["Yes", "No"]);
  assert.equal(analysis.quality_score, 100);
  assert.equal(analysis.liquidity_tier, "deep");
  assert.equal(analysis.dominant_outcome, "No");
  assert.deepEqual(analysis.warnings, []);
});

test("uses the same warning thresholds as the Rust contract", () => {
  const analysis = analyzeNormalizedMarket({
    question: "A thin market",
    outcomes: ["Yes", "No"],
    prices: [0.55, 0.5],
    liquidity_usd: 250,
    volume_24h_usd: 20,
    spread: 0.08,
  });

  assert.equal(analysis.metrics.sum_deviation_bps, 500);
  assert.deepEqual(analysis.warnings, [
    "thin_liquidity",
    "very_low_24h_volume",
    "wide_spread",
    "price_sum_off_one",
  ]);
  assert.ok(analysis.quality_score < 50);
});

test("renders Chinese Markdown plus machine-readable CSV safely", () => {
  const generatedAt = "2026-08-11T12:00:00.000Z";
  const market = buildMarketReport(
    "sample-market",
    {
      slug: "sample-market",
      question: "Will A | B happen?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.4", "0.6"],
      liquidity: 20_000,
      volume24hr: 2_000,
      spread: 0.01,
      active: true,
      closed: false,
      acceptingOrders: true,
      updatedAt: "2026-08-11T11:59:00.000Z",
    },
    generatedAt,
  );
  const report: ClientReport = {
    schema_version: "1.0",
    generated_at: generatedAt,
    source: {
      name: "Polymarket Gamma API",
      endpoint: "https://gamma-api.polymarket.com/markets",
    },
    safety: {
      read_only: true,
      wallet_access: false,
      trading: false,
      financial_advice: false,
    },
    markets: [market],
  };

  const markdown = renderMarkdown(report);
  const csv = renderCsv(report);
  assert.match(markdown, /公开市场体检报告/);
  assert.match(markdown, /不连接钱包、不签名、不下单、不转账/);
  assert.match(markdown, /不构成价格预测、投资建议、交易建议或收益承诺/);
  assert.match(markdown, /Will A \\| B happen\?/);
  assert.match(csv, /sample-market/);
  assert.match(csv, /quality_score/);
});

test("rejects invalid prices before producing a client report", () => {
  assert.throws(
    () =>
      normalizeMarket({
        question: "Bad market",
        outcomes: '["Yes", "No"]',
        outcomePrices: '["1.2", "-0.2"]',
      }),
    /between 0 and 1/,
  );
});

test("makes missing Gamma fields explicit instead of silently presenting complete data", () => {
  const market = buildMarketReport(
    "missing-fields",
    {
      question: "A market with incomplete Gamma fields",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.5", "0.5"],
    },
    "2026-08-11T12:00:00.000Z",
  );

  assert.equal(market.source_updated_at, null);
  assert.equal(market.status_warnings.length, 4);
  assert.match(market.status_warnings.join("\n"), /人工复核/);
  assert.match(market.status_warnings.join("\n"), /数据新鲜度/);
});
