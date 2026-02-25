# Proof-of-Reserve (PoR) workflow

This template provides an end-to-end Proof-of-Reserve (PoR) example. It fetches
reserve data off-chain, reads on-chain totals, optionally enriches the context
with FeedOracle risk signals and a Groq decision step, and then updates
on-chain reserves.

## Configure workflow

Key config fields (see `config.staging.json` / `config.production.json`):

- `schedule` cron expression
- `url` PoR HTTP endpoint
- `feedOracleUrl` optional (defaults to FeedOracle stablecoin endpoint)
- `feedOracleSymbols` optional (symbols you care about)
- `feedOracleMaxStalenessSeconds` optional staleness gate
- `riskThresholds` optional deterministic thresholds
- `dryRun` optional boolean to skip chain writes
- `groq` optional model overrides
- `evms[].symbol` optional symbol mapping for FeedOracle

## API keys (live runs)

FeedOracle requires `X-API-Key` on every request. Set:

- `FEEDORACLE_API_KEY`

Groq is optional and used to summarize anomalies and gate updates. Set:

- `GROQ_API_KEY`

If keys are missing, the workflow logs and skips those steps.

## Simulate

From the repo root:

```bash
/Users/olisehgenesis/.cre/bin/cre --project-root /Users/olisehgenesis/Desktop/Code/chainlink/agent-hause workflow simulate ./erc8004
```
