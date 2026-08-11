# Terminal 3 ADK onboarding report

## Submission summary

- Participant: Jiahao / GitHub `jiahao6635`
- Bounty: Create Agent ID, claim free tokens, and deploy first Rust contract
- Repository: https://github.com/jiahao6635/t3n-polymarket-sentinel
- DID: add after claim-page onboarding
- Contract: `z:<tenant-id>:pm-sentinel`
- Version: `0.1.0`
- Network: Terminal 3 testnet

## What I built

I completed the Quickstart and created a custom Rust/WASM TEE contract rather than stopping at the reference project. The use case is a read-only Polymarket market-quality sentinel. It accepts public market data and returns deterministic liquidity, spread, price-consistency, and activity warnings.

The contract intentionally imports no host capabilities, so it cannot access wallets, secrets, storage, external networks, or trading APIs. This keeps the first deployment easy to audit and safe to demonstrate.

## Completion checklist

- [ ] Sign in through the Terminal 3 claim page
- [ ] Save the one-time API key outside the repository
- [ ] Record the automatically generated DID
- [x] Install Rust and `wasm32-wasip2`
- [x] Build a custom Rust TEE contract
- [x] Add native unit tests
- [x] Build the WASM component locally
- [x] Pass public Rust and TypeScript CI
- [ ] Authenticate the Terminal 3 `T3nClient`
- [ ] Confirm `TenantClient` with `tenant.me()`
- [ ] Register `pm-sentinel` version `0.1.0`
- [ ] Invoke `analyze-market` with public Polymarket data
- [ ] Add screenshots below

## Test evidence

### 1. Claim page and generated identity

Add a redacted screenshot showing successful claim, credits, and DID. Do not show the API key.

### 2. Quickstart authentication

Add a screenshot showing `Connected as: did:t3n:...` and `TenantClient ready.`

### 3. Rust tests and WASM build

Public evidence: [GitHub Actions run 31469356002](https://github.com/jiahao6635/t3n-polymarket-sentinel/actions/runs/31469356002) passed formatting, six Rust unit tests, Clippy with warnings denied, the WASM release build, and TypeScript type-checking. Add a screenshot of the run summary and generated `.wasm` artifact.

### 4. Contract registration

Add a screenshot showing the script name and numeric contract ID. Do not show credentials.

### 5. Contract invocation

Add a screenshot of the decoded quality-analysis result for a public market slug.

## Bugs and documentation friction found

### A. Current Quickstart does not type-check against SDK 4.35.0

Following the Quickstart exactly with `@terminal3/t3n-sdk@4.35.0` produces a TypeScript error because `T3nClientConfig` now requires a `trustAnchor`, but the Quickstart constructor omits it:

```text
Property 'trustAnchor' is missing ... but required in type 'T3nClientConfig'.
```

The SDK's bundled README shows the current pattern: `trustAnchor: await fetchTrustedManifest("testnet")`. Suggested fix: add that import and field to the Quickstart, and briefly explain the explicit unsafe opt-out is only for local/mock nodes.

### B. Current development-environment page calls a removed method

The page instructs developers to run `await tenant.me()`, but `TenantClient` in SDK 4.35.0 has no `me()` method. The operation now lives under the tenant namespace as `await tenant.tenant.me()`.

This fails during type-checking before a developer can test their DID. Suggested fix: update the snippet and expected output to use the namespaced method.

### C. Reference repository README is stale relative to its implementation

In `Terminal-3/z-tenant-flight`, the current Cargo package is version `0.4.1`, while the README still introduces version `0.3.0`. More importantly, the README says `book-offer` receives full passenger PII from the agent, but the current WIT/source accepts an opaque `passenger_id` and resolves PII through `http-with-placeholders` so plaintext PII never enters WASM.

Suggested fix: update the README version, input example, privacy guarantee, host capability list, and architecture diagram to match the current source and walkthrough.

Public upstream report: [Terminal-3/z-tenant-flight#8](https://github.com/Terminal-3/z-tenant-flight/issues/8)

### D. Claim page and Quickstart choose different environment names

The Agent Developer Kit claim page demonstrates `setEnvironment("sandbox")`, while the current Quickstart explicitly uses `setEnvironment("testnet")`. SDK 4.35.0 accepts both names, but the onboarding flow does not explain whether they point to equivalent or different clusters. A developer can claim credits under one label and unknowingly connect to another.

Suggested fix: use one environment consistently through the claim page and walkthrough, or add a short mapping explaining where the claimed DID and credits are available.

### E. Fresh SDK install reports a critical transitive archive-extraction advisory

A clean `npm install @terminal3/t3n-sdk@4.35.0` followed by `npm audit` reports the public `decompress` archive traversal advisories `GHSA-mp2f-45pm-3cg9` and `GHSA-h39j-r5qq-r9mm`. The dependency path observed is:

```text
@terminal3/t3n-sdk
└─ @bytecodealliance/jco
   └─ @bytecodealliance/componentize-js
      └─ @bytecodealliance/weval
         └─ decompress@4.2.1
```

No exploit attempt was made. Suggested fix: review whether the componentization tooling is needed in the published runtime package and upgrade or constrain the affected transitive dependency where compatible.

## Notes for reviewers

- No mainnet transaction, wallet connection, deposit, or paid API is required.
- No private key or Terminal 3 API key is present in the repository.
- The Polymarket integration is read-only and uses the public Gamma endpoint outside the contract.
- The score is a deterministic data-quality heuristic, not financial advice.
