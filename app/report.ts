import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeNormalizedMarket,
  fetchMarket,
  normalizeMarket,
  type GammaMarket,
  type MarketAnalysis,
  type NormalizedMarket,
  type WarningCode,
} from "./market.js";

export type ClientMarketReport = {
  slug: string;
  market_url: string;
  collected_at: string;
  source_updated_at: string | null;
  question: string;
  state: {
    active: boolean | null;
    closed: boolean | null;
    accepting_orders: boolean | null;
  };
  outcomes: Array<{
    name: string;
    raw_price: number;
    normalized_price: number;
  }>;
  dominant_outcome: string;
  dominant_probability: number;
  liquidity_tier: MarketAnalysis["liquidity_tier"];
  quality_score: number;
  quality_label: string;
  metrics: MarketAnalysis["metrics"];
  warnings: Array<{
    code: WarningCode;
    message_zh: string;
  }>;
  status_warnings: string[];
  disclaimer: string;
};

export type ClientReport = {
  schema_version: "1.0";
  generated_at: string;
  source: {
    name: "Polymarket Gamma API";
    endpoint: "https://gamma-api.polymarket.com/markets";
  };
  safety: {
    read_only: true;
    wallet_access: false;
    trading: false;
    financial_advice: false;
  };
  markets: ClientMarketReport[];
};

const WARNING_MESSAGES: Record<WarningCode, string> = {
  thin_liquidity: "流动性低于 1,000 美元，成交承载能力较弱。",
  very_low_24h_volume: "近 24 小时成交额低于 100 美元，市场活跃度很低。",
  wide_spread: "买卖点差高于 300 个基点，价格摩擦较大。",
  price_sum_off_one: "结果价格之和明显偏离 1，报价一致性需要复核。",
};

const DISCLAIMER =
  "本报告仅分析公开市场数据质量，不构成价格预测、投资建议、交易建议或收益承诺。";

export function buildMarketReport(
  slug: string,
  gammaMarket: GammaMarket,
  collectedAt: string,
): ClientMarketReport {
  const normalized = normalizeMarket(gammaMarket);
  const analysis = analyzeNormalizedMarket(normalized);
  return buildMarketReportFromAnalysis(slug, gammaMarket, normalized, analysis, collectedAt);
}

export function renderMarkdown(report: ClientReport): string {
  const lines = [
    "# Polymarket 公开市场体检报告",
    "",
    `- 生成时间：${report.generated_at}`,
    `- 数据来源：[Polymarket Gamma API](${report.source.endpoint})`,
    `- 市场数量：${report.markets.length}`,
    "- 安全边界：只读取公开数据；不连接钱包、不签名、不下单、不转账。",
    `- 重要声明：${DISCLAIMER}`,
    "",
    "## 总览",
    "",
    "| 市场 | 质量分 | 流动性 | 点差 | 24h 成交额 | 价格和偏差 | 警告 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const market of report.markets) {
    lines.push(
      `| [${escapeTable(market.question)}](${market.market_url}) | ${market.quality_score}/100（${market.quality_label}） | ${formatUsd(market.metrics.liquidity_usd)} | ${market.metrics.spread_bps} bps | ${formatUsd(market.metrics.volume_24h_usd)} | ${market.metrics.sum_deviation_bps} bps | ${market.warnings.length + market.status_warnings.length} |`,
    );
  }

  for (const [index, market] of report.markets.entries()) {
    lines.push(
      "",
      `## ${index + 1}. ${market.question}`,
      "",
      `- Slug：\`${market.slug}\``,
      `- 市场页面：${market.market_url}`,
      `- 本次采集：${market.collected_at}`,
      `- 源数据更新：${market.source_updated_at ?? "Gamma 未提供"}`,
      `- 状态：${formatState(market)}`,
      `- 质量分：${market.quality_score}/100（${market.quality_label}）`,
      `- 流动性：${formatUsd(market.metrics.liquidity_usd)}（${liquidityTierZh(market.liquidity_tier)}）`,
      `- 买卖点差：${market.metrics.spread_bps} bps（${formatPercent(market.metrics.spread_bps / 10_000)}）`,
      `- 24h 成交额：${formatUsd(market.metrics.volume_24h_usd)}`,
      `- 24h 活动率：${formatPercent(market.metrics.activity_ratio_bps / 10_000)}（24h 成交额 / 流动性）`,
      `- 价格一致性：价格和 ${market.metrics.price_sum.toFixed(6)}，偏离 1 共 ${market.metrics.sum_deviation_bps} bps`,
      `- 最高归一化价格：${market.dominant_outcome}，${formatPercent(market.dominant_probability)}`,
      "",
      "### 结果价格",
      "",
      "| 结果 | 原始价格 | 归一化价格 |",
      "| --- | ---: | ---: |",
    );
    for (const outcome of market.outcomes) {
      lines.push(
        `| ${escapeTable(outcome.name)} | ${formatPercent(outcome.raw_price)} | ${formatPercent(outcome.normalized_price)} |`,
      );
    }

    lines.push("", "### 警告", "");
    const warnings = [
      ...market.warnings.map((warning) => `${warning.code}：${warning.message_zh}`),
      ...market.status_warnings,
    ];
    if (warnings.length === 0) {
      lines.push("- 未触发预设的数据质量警告。仍应自行核对市场规则、更新时间和数据源。 ");
    } else {
      lines.push(...warnings.map((warning) => `- ${warning}`));
    }
  }

  lines.push(
    "",
    "## 方法与限制",
    "",
    "质量分沿用仓库中 Rust 合约的确定性阈值：流动性、24h 成交额、点差和价格和偏差。它衡量的是数据与交易环境质量，不预测事件结果。公开 API 可能延迟、缺失或调整字段，报告应结合采集时间阅读。",
    "",
    `> ${DISCLAIMER}`,
    "",
  );
  return lines.join("\n");
}

export function renderCsv(report: ClientReport): string {
  const headers = [
    "generated_at",
    "slug",
    "market_url",
    "question",
    "source_updated_at",
    "active",
    "closed",
    "accepting_orders",
    "quality_score",
    "quality_label",
    "liquidity_tier",
    "liquidity_usd",
    "volume_24h_usd",
    "activity_ratio_bps",
    "spread_bps",
    "price_sum",
    "sum_deviation_bps",
    "dominant_outcome",
    "dominant_probability",
    "outcomes",
    "raw_prices",
    "normalized_prices",
    "warnings",
  ];
  const rows = report.markets.map((market) => [
    report.generated_at,
    market.slug,
    market.market_url,
    market.question,
    market.source_updated_at ?? "",
    nullableBoolean(market.state.active),
    nullableBoolean(market.state.closed),
    nullableBoolean(market.state.accepting_orders),
    market.quality_score,
    market.quality_label,
    market.liquidity_tier,
    market.metrics.liquidity_usd,
    market.metrics.volume_24h_usd,
    market.metrics.activity_ratio_bps,
    market.metrics.spread_bps,
    market.metrics.price_sum,
    market.metrics.sum_deviation_bps,
    market.dominant_outcome,
    market.dominant_probability,
    market.outcomes.map((outcome) => outcome.name).join(" | "),
    market.outcomes.map((outcome) => outcome.raw_price).join(" | "),
    market.outcomes.map((outcome) => outcome.normalized_price).join(" | "),
    [
      ...market.warnings.map((warning) => warning.code),
      ...market.status_warnings,
    ].join(" | "),
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.slugs.length === 0) {
    throw new Error(`At least one public market slug is required.\n\n${usage()}`);
  }

  const generatedAt = new Date().toISOString();
  const gammaMarkets = await Promise.all(
    options.slugs.map(async (slug) => ({ slug, market: await fetchMarket(slug) })),
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
    markets: gammaMarkets.map(({ slug, market }) => buildMarketReport(slug, market, generatedAt)),
  };

  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const basename = options.name ?? defaultBasename(generatedAt);
  const markdownPath = resolve(outputDir, `${basename}.md`);
  const jsonPath = resolve(outputDir, `${basename}.json`);
  const csvPath = resolve(outputDir, `${basename}.csv`);
  await Promise.all([
    writeFile(markdownPath, renderMarkdown(report), "utf8"),
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(csvPath, renderCsv(report), "utf8"),
  ]);

  console.log(`Generated ${report.markets.length} read-only market report(s):`);
  console.log(markdownPath);
  console.log(jsonPath);
  console.log(csvPath);
  console.log(DISCLAIMER);
}

function buildMarketReportFromAnalysis(
  slug: string,
  gammaMarket: GammaMarket,
  normalized: NormalizedMarket,
  analysis: MarketAnalysis,
  collectedAt: string,
): ClientMarketReport {
  const statusWarnings: string[] = [];
  if (gammaMarket.closed === true) statusWarnings.push("市场已关闭，当前数据不代表可交易状态。");
  if (gammaMarket.active === false) statusWarnings.push("Gamma 将该市场标记为非活跃状态。");
  if (gammaMarket.acceptingOrders === false) statusWarnings.push("市场当前不接受订单。");
  if (gammaMarket.liquidity === undefined) {
    statusWarnings.push("Gamma 未提供流动性字段；评分按共享归一化规则以 0 处理。");
  }
  if (gammaMarket.volume24hr === undefined) {
    statusWarnings.push("Gamma 未提供 24h 成交额字段；评分按共享归一化规则以 0 处理。");
  }
  if (gammaMarket.spread === undefined) {
    statusWarnings.push("Gamma 未提供点差字段；报告按共享归一化规则以 0 处理，需人工复核。");
  }
  if (gammaMarket.updatedAt === undefined) {
    statusWarnings.push("Gamma 未提供源数据更新时间，无法判断数据新鲜度。");
  }

  return {
    slug,
    market_url: `https://polymarket.com/event/${encodeURIComponent(slug)}`,
    collected_at: collectedAt,
    source_updated_at: gammaMarket.updatedAt ?? null,
    question: normalized.question.trim(),
    state: {
      active: gammaMarket.active ?? null,
      closed: gammaMarket.closed ?? null,
      accepting_orders: gammaMarket.acceptingOrders ?? null,
    },
    outcomes: normalized.outcomes.map((name, index) => ({
      name: name.trim(),
      raw_price: normalized.prices[index]!,
      normalized_price: analysis.normalized_prices[index]!,
    })),
    dominant_outcome: analysis.dominant_outcome,
    dominant_probability: analysis.dominant_probability,
    liquidity_tier: analysis.liquidity_tier,
    quality_score: analysis.quality_score,
    quality_label: qualityLabel(analysis.quality_score),
    metrics: analysis.metrics,
    warnings: analysis.warnings.map((code) => ({ code, message_zh: WARNING_MESSAGES[code] })),
    status_warnings: statusWarnings,
    disclaimer: DISCLAIMER,
  };
}

function parseArgs(args: string[]): {
  slugs: string[];
  outputDir: string;
  name?: string;
  help: boolean;
} {
  const slugs: string[] = [];
  let outputDir = "reports";
  let name: string | undefined;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--out-dir") {
      outputDir = requireOptionValue(args, ++index, arg);
    } else if (arg === "--name") {
      name = requireOptionValue(args, ++index, arg);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new Error("--name may contain only letters, numbers, dot, underscore, and hyphen");
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      const slug = arg.trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        throw new Error(`Invalid public market slug: ${arg}`);
      }
      slugs.push(slug);
    }
  }
  return { slugs: [...new Set(slugs)], outputDir, name, help };
}

function requireOptionValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function usage(): string {
  return [
    "Usage: npm run report -- <market-slug> [more-slugs...] [options]",
    "",
    "Options:",
    "  --out-dir <directory>  Output directory (default: reports)",
    "  --name <basename>       Output basename without extension",
    "  -h, --help              Show this help",
    "",
    "The command only reads public Gamma API data and writes Markdown, JSON, and CSV files.",
    "It does not use a wallet, API key, order endpoint, signing capability, or trading action.",
  ].join("\n");
}

function defaultBasename(iso: string): string {
  return `polymarket-health-${iso.replace(/[:.]/g, "-")}`;
}

function qualityLabel(score: number): string {
  if (score >= 85) return "数据质量良好";
  if (score >= 70) return "数据质量一般";
  if (score >= 50) return "数据质量偏弱";
  return "数据质量较差";
}

function liquidityTierZh(tier: ClientMarketReport["liquidity_tier"]): string {
  return tier === "deep" ? "深" : tier === "medium" ? "中等" : "薄";
}

function formatState(market: ClientMarketReport): string {
  return [
    `活跃=${nullableBoolean(market.state.active) || "未知"}`,
    `已关闭=${nullableBoolean(market.state.closed) || "未知"}`,
    `接受订单=${nullableBoolean(market.state.accepting_orders) || "未知"}`,
  ].join("，");
}

function nullableBoolean(value: boolean | null): string {
  return value === null ? "" : value ? "true" : "false";
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
