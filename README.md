# AgentHaus Risk & Compliance + CRE & AI Demo

This repository contains two related projects:

1. **agent-cli** – a lightweight Node/TypeScript command‑line tool for
   interacting with an ERC‑8004 registry, managing agent reputations, and
   queuing Chainlink CRE workflows.
2. **agent‑hause/erc8004** – a CRE proof‑of‑reserves workflow that combines:
   on‑chain totals, FeedOracle risk signals, and an LLM decision step. It
   blocks or allows on‑chain updates based on deterministic thresholds and
   AI‑assisted analysis.

The code here is experimental; it demonstrates patterns you can use to:

* handle ERC‑8004 grants via CRE workflows,
* allow agents to sign transactions with a private key stored in environment
  variables,
* read and write both on‑chain (via `ethers`) and off‑chain (via APIs or file
  storage),
* deploy simple contracts, query oracles, and coordinate on/off‑chain rights.

## What this project does

This workflow is built for the **Risk & Compliance** and **CRE & AI** tracks.
It continuously monitors stablecoin reserves and health, and it can:

* fetch off‑chain reserve data and on‑chain totals,
* enrich the context with regulated risk signals (MiCA status, risk flags),
* apply deterministic safeguards (thresholds + staleness checks),
* use an LLM to summarize anomalies and gate execution, and
* log a full audit trail for review.

In short, it demonstrates automated risk monitoring and AI‑assisted safeguards
that are verifiable and auditable.

## Quick start

```bash
# install dependencies at repo root
pnpm install

# compile TypeScript, or run via tsx directly
pnpm run build        # if you add a build script
```

Make sure you have a `.env` file with the following variables for each
network you intend to use:

```ini
RPC_URL_SEPOLIA=https://sepolia.infura.io/v3/...
PRIVATE_KEY_SEPOLIA=0x...
RPC_URL_BASE=https://base.infura.io/v3/...
PRIVATE_KEY_BASE=0x...
CRE_API_KEY=...      # required for queueing workflows
```

You can run the CLI from `dist/cli.js` (after building) or directly with
`tsx`:

```bash
npx tsx cli.ts list
npx tsx cli.ts grant -a AG-001 -s 0.85 -n sepolia
npx tsx cli.ts fetch-price
npx tsx cli.ts write-price -c 0xYourOracleAddress -n sepolia
```

For more details on the commands, run `npx tsx cli.ts --help`.

## Workflow overview (Risk & Compliance + AI)

The CRE workflow lives in:

* `/Users/olisehgenesis/Desktop/Code/chainlink/agent-hause/erc8004/main.ts`

Key pipeline:

* On‑chain totals via `BalanceReader` and ERC‑20 `totalSupply`.
* Off‑chain reserve snapshot from Verinumus PoR API.
* FeedOracle stablecoin risk snapshot (MiCA status, peg deviation, etc.).
* Deterministic thresholds (peg deviation, reserve ratio, score, staleness).
* Groq LLM decision to summarize anomalies and optionally block updates.

## Run the workflow

### 1) Install workflow dependencies

```bash
cd /Users/olisehgenesis/Desktop/Code/chainlink/agent-hause/erc8004
/Users/olisehgenesis/.bun/bin/bun install
```

### 2) Configure secrets (recommended)

Store API keys via CRE secrets and reference them in the workflow settings.
The workflow already points to `../secrets.yaml`.

Edit `/Users/olisehgenesis/Desktop/Code/chainlink/agent-hause/secrets.yaml`
to include the secret names:

```yaml
secretsNames:
  FEEDORACLE_API_KEY:
    - FEEDORACLE_API_KEY
  GROQ_API_KEY:
    - GROQ_API_KEY
```

Then register your secrets (example):

```bash
/Users/olisehgenesis/.cre/bin/cre secrets set FEEDORACLE_API_KEY
/Users/olisehgenesis/.cre/bin/cre secrets set GROQ_API_KEY
```

Optional if you want to broadcast or simulate signed writes:

```ini
CRE_ETH_PRIVATE_KEY=...
RPC_URL_SEPOLIA=...
```

### 3) Run the simulation

Make sure `bun` is on your PATH, then run:

```bash
cre --project-root ./agent-hause --target staging-settings workflow simulate ./erc8004
```

### 4) What to expect

The simulation logs:

* on‑chain totals,
* FeedOracle snapshot,
* threshold evaluation,
* Groq decision,
* and whether the on‑chain update was blocked or allowed.

## Off‑chain data example

The new `fetch-price` command is a concrete example of pulling data from an
external API (Coingecko) and then optionally writing it to an on‑chain
``PriceOracle`` contract via `write-price`.  Two helper modules support this:

* `lib/api.ts` – simple fetch wrapper for the Coingecko endpoint.
* `agent-hause/contracts/abi/PriceOracle.ts` – minimal ABI for the oracle
  contract used by the CLI.

You can replace the Coingecko call with any other REST API (weather, yield
rates, etc.).  A CRE workflow can trigger these commands automatically and
record the results both off‑chain (logs, datastore) and on‑chain (contract
state).

### CRE tutorial integration

This repo now follows the pattern from the CRE docs [Part 2: Fetching Offchain Data](https://docs.chain.link/cre/getting-started/part-2-fetching-data-ts).  The `agent-hause/erc8004` workflow has been updated accordingly:

* `config.{staging,production}.json` include an `apiUrl` property (defaulting
  to the mathjs random‑number endpoint).
* `main.ts` implements a `fetchMathResult` helper and invokes it via
  `runtime.runInNodeMode(..., consensusMedianAggregation())` when `apiUrl` is
  present.  The result is logged before the existing proof‑of‑reserve logic.

This demonstrates the `runInNodeMode` + consensus pattern described in the
guide, ensuring non‑deterministic off‑chain data is aggregated securely.

Feel free to read the full tutorial and adapt the workflow for your own
agents – the code is already wired to match the example, so you can copy
snippets directly.

### FeedOracle risk context (Risk & Compliance)

The `agent-hause/erc8004` workflow now pulls FeedOracle stablecoin risk signals
and can forward a combined context (on-chain totals + FeedOracle snapshot) to a
Groq LLM decision step. This aligns well with the Risk & Compliance track,
because you can justify gating actions using regulated-risk metadata.

Key integration notes:

* FeedOracle requires the `X-API-Key` header on every request. The workflow
  uses `HTTPClient` headers in `agent-hause/erc8004/main.ts` and will skip the
  FeedOracle call if the key is not configured.
* For live runs, store `FEEDORACLE_API_KEY` (and optionally `GROQ_API_KEY`) in
  CRE secrets or your environment. Local simulation does not require the keys;
  the workflow logs and continues without the external calls.
* The Groq prompt is defined in `agent-hause/erc8004/main.ts` and expects a
  strict JSON response containing `riskLevel`, `allowUpdate`, `summary`, and
  `flags`. If `allowUpdate` is false, the workflow skips `updateReserves`.

## Extending the system

* Add new ERC‑8004 workflows by modifying `data/sampleAgents.ts` and
a corresponding CRE project under `agent-hause/erc8004` or a new directory.
* Use the `grant` command to update reputations from scripts or workflows.  It
uses the private key in your environment to sign the transaction.
* Store off‑chain metadata in JSON files, a database, or directly in CRE
workflow outputs; the `fetch-price` command shows one simple pattern.

The CRE bootcamp notes at
https://smartcontractkit.github.io/cre-bootcamp-2026 contain additional
examples for on‑chain/off‑chain integration and are a great reference.

---

Feel free to reorganize this repo into a monorepo or packages as the project
grows.  The current layout is intentionally simple to keep the focus on the
examples.

## CREA agent overview

This repository hosts `agent-cli` and the accompanying CRE demo.  The
architecture is built around autonomous agents that:

* hold an ERC‑8004 reputation score and a wallet (private key supplied via
  environment variables),
* interact with on‑chain contracts (ERC‑20s, oracles, etc.),
* fetch off‑chain data from APIs or Chainlink oracles, and
* execute Chainlink CRE workflows to make decisions or update state.

### Suitable tracks

* **CRE & AI** – agents are essentially automated workflows that use CRE
  triggers and off‑chain logic to perform actions on chain.  AI oracles can
  plug into the agent logic, making this a natural fit.
* **Risk & Compliance** – the primary use case is reputation grants and
  monitoring, which align with compliance-focused applications.

The same workflow code can be adapted for either track; the distinction lies in
how you frame the agent’s purpose.  

For example, a workflow might:

```ts
// fetch off-chain price
const price = await fetchEthUsdPrice();
if (price > threshold) {
  await runShell(`node cli.js grant -a ${agentId} -s 0.9 -n sepolia`);
}
```

This pattern is usable in both CRE & AI and Risk & Compliance contexts.

---

Feel free to reorganize this repo into a monorepo or packages as the project
grows.  The current layout is intentionally simple to keep the focus on the
examples.
# cre-agenthaus
