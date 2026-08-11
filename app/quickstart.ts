import { readFile, writeFile } from "node:fs/promises";
import {
  T3nClient,
  TenantClient,
  createEthAuthInput,
  eth_get_address,
  fetchTrustedManifest,
  getNodeUrl,
  getScriptVersion,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
} from "@terminal3/t3n-sdk";
import type { Environment, TrustAnchorOrUnsafe } from "@terminal3/t3n-sdk";
import { fetchMarket, normalizeMarket } from "./market.js";

type Action = "connect" | "register" | "invoke" | "all";

const action = (process.argv[2] ?? "connect") as Action;
const slug = process.argv[3] ?? "will-gavin-newsom-win-the-2028-democratic-presidential-nomination-568";
const allowedActions: Action[] = ["connect", "register", "invoke", "all"];

if (!allowedActions.includes(action)) {
  throw new Error(`Unknown action: ${action}. Use ${allowedActions.join(", ")}.`);
}

const apiKey = process.env.T3N_API_KEY;
if (!apiKey) {
  throw new Error("T3N_API_KEY is missing. Load it from a local ignored file or shell environment.");
}

const environment = parseEnvironment(process.env.T3N_ENV ?? "sandbox");
setEnvironment(environment);

const wasmComponent = await loadWasmComponent();
const address = eth_get_address(apiKey);
const trustAnchor = await resolveTrustAnchor(environment);
const t3n = new T3nClient({
  baseUrl: getNodeUrl(),
  trustAnchor,
  wasmComponent,
  handlers: {
    EthSign: metamask_sign(address, undefined, apiKey),
  },
});

await t3n.handshake();
const auth = await t3n.authenticate(createEthAuthInput(address));
const tenantDid = auth.value;
console.log("Environment:", environment);
console.log("Connected as:", tenantDid);

const tenant = new TenantClient({
  t3n,
  baseUrl: getNodeUrl(),
  tenantDid,
});
await tenant.tenant.me();
console.log("TenantClient ready.");

const contractTail = "pm-sentinel";
const contractVersion = "0.1.0";
const tenantId = tenantDid.slice("did:t3n:".length);
const scriptName = `z:${tenantId}:${contractTail}`;

if (action === "register" || action === "all") {
  const wasmPath = new URL(
    "../target/wasm32-wasip2/release/z_polymarket_sentinel.wasm",
    import.meta.url,
  );
  const wasm = await readFile(wasmPath);
  const result = await tenant.contracts.register({
    tail: contractTail,
    version: contractVersion,
    wasm,
  });

  const deployment = {
    tenantDid,
    scriptName,
    contractId: result.contract_id,
    contractVersion,
    registeredAt: new Date().toISOString(),
  };
  await writeFile(
    new URL("../.terminal3-deployment.json", import.meta.url),
    `${JSON.stringify(deployment, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log("Registered contract:", deployment);
}

if (action === "invoke" || action === "all") {
  const market = await fetchMarket(slug);
  const scriptVersion = await getScriptVersion(getNodeUrl(), scriptName);
  const result = await t3n.executeAndDecode({
    script_name: scriptName,
    script_version: scriptVersion,
    function_name: "analyze-market",
    input: normalizeMarket(market),
  });

  console.log("Contract result:");
  console.log(JSON.stringify(result, null, 2));
}

function parseEnvironment(raw: string): Environment {
  if (raw === "sandbox" || raw === "testnet" || raw === "production") {
    return raw;
  }
  throw new Error(`Unsupported T3N_ENV: ${raw}`);
}

async function resolveTrustAnchor(environment: Environment): Promise<TrustAnchorOrUnsafe> {
  if (process.env.T3N_UNSAFE_TRUST_SERVER === "1") {
    if (environment === "production") {
      throw new Error("Unsafe server trust is forbidden in production.");
    }
    console.warn("WARNING: TEE trust-anchor verification is disabled for this non-production run.");
    return { unsafe_trust_server: true };
  }
  return fetchTrustedManifest(environment);
}
