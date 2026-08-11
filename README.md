# T3N Polymarket Sentinel

[![CI](https://github.com/jiahao6635/t3n-polymarket-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/jiahao6635/t3n-polymarket-sentinel/actions/workflows/ci.yml)

A read-only Rust/WASM contract for Terminal 3 that screens public Polymarket data for liquidity, spread, price consistency, and activity risk.

This project is a submission for the [Terminal3 Agent ID + first Rust contract bounty](https://superteam.fun/earn/listing/ai-id/). It adds a practical prediction-market use case while keeping the contract deliberately unable to trade or access funds.

## Safety boundary

The contract imports no Terminal 3 host capabilities. It cannot:

- access a wallet or private key;
- sign or submit an order;
- deposit, withdraw, or move funds;
- call an external network;
- read secrets or persistent storage.

The TypeScript adapter fetches public data from Polymarket's Gamma API, normalizes six non-sensitive fields, and sends them to the contract for deterministic analysis. The output is data-quality screening, not a price forecast or trading recommendation.

## What the contract returns

`analyze-market` validates the payload and returns:

- normalized outcome probabilities;
- the dominant outcome and normalized probability;
- spread and price-sum deviation in basis points;
- liquidity tier and 24-hour activity ratio;
- a deterministic quality score from 0 to 100;
- explicit warnings for thin liquidity, low activity, wide spreads, or inconsistent prices.

## Architecture

```mermaid
flowchart LR
    A[Public Polymarket Gamma API] -->|public market fields| B[TypeScript adapter]
    B -->|normalized JSON| C[Terminal 3 TEE contract]
    C --> D[quality score and warnings]
    X[Wallet or trading API] -. no connection .-> C
```

## Build and test the Rust contract

Requirements: Rust stable and the `wasm32-wasip2` target.

```bash
rustup target add wasm32-wasip2
cargo test --lib
cargo clippy --all-targets -- -D warnings
cargo build --target wasm32-wasip2 --release
```

The WASM component is generated at:

```text
target/wasm32-wasip2/release/z_polymarket_sentinel.wasm
```

Optional interface verification:

```bash
wasm-tools component wit target/wasm32-wasip2/release/z_polymarket_sentinel.wasm
```

## Connect, register, and invoke on Terminal 3 sandbox

The Terminal 3 claim page shows the API key only once. Keep it in a local ignored file or shell environment; never paste it into a repository, issue, screenshot, or submission document.

```bash
cd app
npm install

# Load T3N_API_KEY into the current shell without printing it.
npm run connect
npm run register
npm run invoke -- <polymarket-market-slug>
```

For a fresh tenant, `npm run all -- <slug>` performs registration and one invocation in a single run. Registration versions are immutable, so do not rerun `register` with the same version.

The claim page currently provisions the sandbox flow, so the adapter defaults to `T3N_ENV=sandbox`. Override it with `T3N_ENV=testnet` only when the DID and credits were provisioned there.

SDK 4.35.0 requires a signed trust anchor. The adapter attempts `fetchTrustedManifest()` by default and fails closed if it cannot verify one. For a non-production onboarding run only, `T3N_UNSAFE_TRUST_SERVER=1` enables the SDK's explicit unsafe opt-out; this is never allowed when `T3N_ENV=production`.

The verified sandbox deployment is contract ID `590`, script `z:6c90567a5d037e13ae0817b22e6a6fec6630a901:pm-sentinel`, version `0.1.0`. A successful public-data invocation is recorded in [the submission report](docs/submission-report.md), with a visually verified [Google Docs-targeted DOCX](docs/Terminal3_ADK_Submission_Jiahao.docx) ready for import.

## Example input

```json
{
  "question": "Will the sample event resolve Yes?",
  "outcomes": ["Yes", "No"],
  "prices": [0.42, 0.58],
  "liquidity_usd": 125000,
  "volume_24h_usd": 18000,
  "spread": 0.006
}
```

## Repository layout

```text
src/                 Rust contract and unit tests
wit/world.wit        exported Terminal 3 contract interface
app/quickstart.ts    connect, register, fetch public market data, invoke
fixtures/            safe sample input
docs/                bounty submission report and evidence
```

## License

MIT
