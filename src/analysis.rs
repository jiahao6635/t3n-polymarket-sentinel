use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MarketInput {
    question: String,
    outcomes: Vec<String>,
    prices: Vec<f64>,
    liquidity_usd: f64,
    volume_24h_usd: f64,
    spread: f64,
}

#[derive(Debug, Serialize)]
struct AnalysisResponse {
    question: String,
    normalized_prices: Vec<f64>,
    dominant_outcome: String,
    dominant_probability: f64,
    liquidity_tier: &'static str,
    quality_score: u8,
    metrics: Metrics,
    warnings: Vec<&'static str>,
    disclaimer: &'static str,
}

#[derive(Debug, Serialize)]
struct Metrics {
    price_sum: f64,
    sum_deviation_bps: u32,
    spread_bps: u32,
    liquidity_usd: f64,
    volume_24h_usd: f64,
    activity_ratio_bps: u32,
}

pub(crate) fn analyze_market(input: &[u8]) -> Result<Vec<u8>, String> {
    let market: MarketInput = serde_json::from_slice(input)
        .map_err(|error| format!("analyze-market: bad input: {error}"))?;

    validate(&market)?;

    let price_sum: f64 = market.prices.iter().sum();
    if price_sum <= f64::EPSILON {
        return Err("analyze-market: prices must have a positive sum".to_string());
    }

    let normalized_prices: Vec<f64> = market
        .prices
        .iter()
        .map(|price| round_to(price / price_sum, 6))
        .collect();

    let dominant_index =
        normalized_prices
            .iter()
            .enumerate()
            .fold(0usize, |best, (index, value)| {
                if *value > normalized_prices[best] {
                    index
                } else {
                    best
                }
            });

    let sum_deviation_bps = to_bps((price_sum - 1.0).abs());
    let spread_bps = to_bps(market.spread);
    let activity_ratio_bps = if market.liquidity_usd <= f64::EPSILON {
        0
    } else {
        ((market.volume_24h_usd / market.liquidity_usd) * 10_000.0)
            .round()
            .clamp(0.0, u32::MAX as f64) as u32
    };

    let liquidity_tier = if market.liquidity_usd >= 100_000.0 {
        "deep"
    } else if market.liquidity_usd >= 10_000.0 {
        "medium"
    } else {
        "thin"
    };

    let mut warnings = Vec::new();
    if market.liquidity_usd < 1_000.0 {
        warnings.push("thin_liquidity");
    }
    if market.volume_24h_usd < 100.0 {
        warnings.push("very_low_24h_volume");
    }
    if spread_bps > 300 {
        warnings.push("wide_spread");
    }
    if sum_deviation_bps > 200 {
        warnings.push("price_sum_off_one");
    }

    let quality_score = quality_score(
        market.liquidity_usd,
        market.volume_24h_usd,
        spread_bps,
        sum_deviation_bps,
    );

    let response = AnalysisResponse {
        question: market.question.trim().to_string(),
        normalized_prices,
        dominant_outcome: market.outcomes[dominant_index].trim().to_string(),
        dominant_probability: round_to(market.prices[dominant_index] / price_sum, 6),
        liquidity_tier,
        quality_score,
        metrics: Metrics {
            price_sum: round_to(price_sum, 6),
            sum_deviation_bps,
            spread_bps,
            liquidity_usd: round_to(market.liquidity_usd, 2),
            volume_24h_usd: round_to(market.volume_24h_usd, 2),
            activity_ratio_bps,
        },
        warnings,
        disclaimer: "Data-quality screening only; not trading advice.",
    };

    serde_json::to_vec(&response)
        .map_err(|error| format!("analyze-market: serialization failed: {error}"))
}

fn validate(market: &MarketInput) -> Result<(), String> {
    if market.question.trim().is_empty() || market.question.len() > 500 {
        return Err("analyze-market: question must contain 1-500 characters".to_string());
    }
    if !(2..=8).contains(&market.outcomes.len()) {
        return Err("analyze-market: outcomes must contain 2-8 labels".to_string());
    }
    if market.outcomes.len() != market.prices.len() {
        return Err("analyze-market: outcomes and prices must have equal length".to_string());
    }
    if market
        .outcomes
        .iter()
        .any(|outcome| outcome.trim().is_empty())
    {
        return Err("analyze-market: outcome labels cannot be empty".to_string());
    }
    if market
        .prices
        .iter()
        .any(|price| !price.is_finite() || !(0.0..=1.0).contains(price))
    {
        return Err("analyze-market: every price must be finite and between 0 and 1".to_string());
    }
    if !market.liquidity_usd.is_finite() || market.liquidity_usd < 0.0 {
        return Err("analyze-market: liquidity_usd must be finite and non-negative".to_string());
    }
    if !market.volume_24h_usd.is_finite() || market.volume_24h_usd < 0.0 {
        return Err("analyze-market: volume_24h_usd must be finite and non-negative".to_string());
    }
    if !market.spread.is_finite() || !(0.0..=1.0).contains(&market.spread) {
        return Err("analyze-market: spread must be finite and between 0 and 1".to_string());
    }
    Ok(())
}

fn quality_score(
    liquidity_usd: f64,
    volume_24h_usd: f64,
    spread_bps: u32,
    sum_deviation_bps: u32,
) -> u8 {
    let mut score = 100i32;

    score -= if liquidity_usd < 1_000.0 {
        35
    } else if liquidity_usd < 10_000.0 {
        15
    } else {
        0
    };
    score -= if volume_24h_usd < 100.0 { 10 } else { 0 };
    score -= if spread_bps > 1_000 {
        40
    } else if spread_bps > 500 {
        30
    } else if spread_bps > 200 {
        15
    } else {
        0
    };
    score -= if sum_deviation_bps > 500 {
        25
    } else if sum_deviation_bps > 200 {
        10
    } else {
        0
    };

    score.clamp(0, 100) as u8
}

fn to_bps(value: f64) -> u32 {
    (value * 10_000.0).round().clamp(0.0, u32::MAX as f64) as u32
}

fn round_to(value: f64, decimals: i32) -> f64 {
    let factor = 10_f64.powi(decimals);
    (value * factor).round() / factor
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn run(value: Value) -> Value {
        let bytes = serde_json::to_vec(&value).unwrap();
        serde_json::from_slice(&analyze_market(&bytes).unwrap()).unwrap()
    }

    #[test]
    fn scores_a_deep_tight_market_highly() {
        let result = run(json!({
            "question": "Will the sample event resolve Yes?",
            "outcomes": ["Yes", "No"],
            "prices": [0.42, 0.58],
            "liquidity_usd": 125000.0,
            "volume_24h_usd": 18000.0,
            "spread": 0.006
        }));

        assert_eq!(result["liquidity_tier"], "deep");
        assert_eq!(result["quality_score"], 100);
        assert_eq!(result["dominant_outcome"], "No");
        assert_eq!(result["warnings"], json!([]));
    }

    #[test]
    fn normalizes_prices_and_reports_sum_deviation() {
        let result = run(json!({
            "question": "A two-sided test market",
            "outcomes": ["Yes", "No"],
            "prices": [0.60, 0.45],
            "liquidity_usd": 25000.0,
            "volume_24h_usd": 3000.0,
            "spread": 0.02
        }));

        assert_eq!(result["metrics"]["sum_deviation_bps"], 500);
        assert_eq!(result["warnings"], json!(["price_sum_off_one"]));
        let normalized_sum = result["normalized_prices"]
            .as_array()
            .unwrap()
            .iter()
            .map(Value::as_f64)
            .map(Option::unwrap)
            .sum::<f64>();
        assert!((normalized_sum - 1.0).abs() < 0.00001);
    }

    #[test]
    fn flags_thin_inactive_wide_markets() {
        let result = run(json!({
            "question": "A risky test market",
            "outcomes": ["Yes", "No"],
            "prices": [0.50, 0.50],
            "liquidity_usd": 250.0,
            "volume_24h_usd": 20.0,
            "spread": 0.08
        }));

        assert_eq!(result["liquidity_tier"], "thin");
        assert!(result["quality_score"].as_u64().unwrap() < 50);
        assert_eq!(
            result["warnings"],
            json!(["thin_liquidity", "very_low_24h_volume", "wide_spread"])
        );
    }

    #[test]
    fn rejects_mismatched_outcomes_and_prices() {
        let input = serde_json::to_vec(&json!({
            "question": "Bad market",
            "outcomes": ["Yes", "No"],
            "prices": [0.5],
            "liquidity_usd": 1000.0,
            "volume_24h_usd": 100.0,
            "spread": 0.01
        }))
        .unwrap();

        let error = analyze_market(&input).unwrap_err();
        assert!(error.contains("equal length"));
    }

    #[test]
    fn rejects_unknown_fields() {
        let input = serde_json::to_vec(&json!({
            "question": "Bad market",
            "outcomes": ["Yes", "No"],
            "prices": [0.5, 0.5],
            "liquidity_usd": 1000.0,
            "volume_24h_usd": 100.0,
            "spread": 0.01,
            "private_key": "must-never-be-accepted"
        }))
        .unwrap();

        let error = analyze_market(&input).unwrap_err();
        assert!(error.contains("unknown field"));
    }
}
