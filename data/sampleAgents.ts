export type AgentStatus = 'Idle' | 'Running' | 'Throttled' | 'Paused';
export type Network = 'base' | 'sepolia';

export interface AgentRecord {
  id: string;
  name: string;
  owner: string;
  handle: string;
  description: string;
  reputationScore: number; // 0..1
  spendingCapUsd: number;
  usedUsd: number;
  status: AgentStatus;
  throttleReason?: string;
  lastWorkflow: string;
  chain: string;
  network: Network;
  createdAt: string;
}

export const sampleAgents: AgentRecord[] = [
  {
    id: 'AG-001',
    name: 'Sentry Synth',
    owner: '0xA4d9c3b1a15e83f4deed6c2f4b48b026d1bd03c3',
    handle: 'sentry-synth',
    description: 'AI-run risk monitor that enforces stablecoin burn thresholds.',
    reputationScore: 0.92,
    spendingCapUsd: 12000,
    usedUsd: 3800,
    status: 'Running',
    lastWorkflow: 'Oracle sanity & burn execution',
    chain: 'Ethereum Mainnet + Base Sepolia',
    network: 'base',
    createdAt: '2025-11-06',
  },
  {
    id: 'AG-002',
    name: 'Trusty Teller',
    owner: '0x5b1fe0d9e5f4ea3285c61dffb8b1bb7b45b57d2c',
    handle: 'trusty-teller',
    description: 'Prediction market reporter that only speaks when reputation > 0.78.',
    reputationScore: 0.82,
    spendingCapUsd: 5400,
    usedUsd: 1350,
    status: 'Throttled',
    throttleReason: 'Rep dropped to 0.65 → CAP reduced 45%',
    lastWorkflow: 'Resolve Sports Market 14',
    chain: 'Polygon + Sepolia Mirror',
    network: 'sepolia',
    createdAt: '2025-12-18',
  },
  {
    id: 'AG-009',
    name: 'Protocol Whisper',
    owner: '0xC7e435f2b91dd5e64f3067c2dd67c8334a2395f2',
    handle: 'protocol-whisper',
    description: 'Compliance analyst for cross-chain collateral flows.',
    reputationScore: 0.76,
    spendingCapUsd: 3400,
    usedUsd: 2940,
    status: 'Idle',
    lastWorkflow: 'Compliance guard for base bridge',
    chain: 'Base Chain + Sepolia',
    network: 'base',
    createdAt: '2026-01-04',
  },
  {
    id: 'AG-015',
    name: 'Vault Muse',
    owner: '0x2d8c7a4f5ad09e2f1c29b4d284ee5d43c9d8a8e4',
    handle: 'vault-muse',
    description: 'Tokenization curator that only runs when reviewers approve.',
    reputationScore: 0.58,
    spendingCapUsd: 9000,
    usedUsd: 8200,
    status: 'Paused',
    throttleReason: 'Awaiting reviewer attestations after data ambiguity.',
    lastWorkflow: 'Mint tranche 3 for vault 21',
    chain: 'Ethereum + Base Sepolia',
    network: 'base',
    createdAt: '2025-09-22',
  },
];

export const workflowTemplates = [
  {
    id: 'wf-erc8004-check',
    name: 'ERC-8004 Verification Gate',
    summary: 'Fetch reputation snapshot → enforce spending cap or pause if score < 0.7.',
    trustThreshold: 0.7,
  },
  {
    id: 'wf-erc8004-response',
    name: 'Reputation Feedback Loop',
    summary: 'Publish CRE execution events back to ERC-8004 Validation Registry.',
    trustThreshold: 0.6,
  },
  {
    id: 'wf-cre-ai',
    name: 'CRE Agent Orchestrator',
    summary: 'Chainlink CRE + LLM pipeline that routes tasks based on score weight.',
    trustThreshold: 0.65,
  },
  {
    id: 'wf-fetch-price',
    name: 'Price Oracle Updater',
    summary: 'Fetch ETH/USD price from Coingecko and write to on-chain oracle.',
    trustThreshold: 0.0,
  },
  {
    id: 'wf-grant-based-on-price',
    name: 'Reputation Granter',
    summary: 'Give ERC-8004 grant if off-chain price exceeds threshold.',
    trustThreshold: 0.0,
  },
];
