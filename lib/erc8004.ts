import { Contract, ethers } from 'ethers';
import type { Network } from '../data/sampleAgents';

const REP_ABI = [
  'function reputationScore(bytes32 agentId) view returns (uint256)',
  'function updateReputation(bytes32 agentId, uint256 newScore)',
];

const VALIDATION_ABI = ['function logEvidence(bytes32 agentId, string payload)'];

const ADDRESS_MAP: Record<Network, { reputation: string; identity: string; validation: string }> = {
  base: {
    reputation: process.env.ERC8004_BASE_REPUTATION_ADDRESS ?? '0x0000000000000000000000000000000000001000',
    identity: process.env.ERC8004_BASE_IDENTITY_ADDRESS ?? '0x0000000000000000000000000000000000001001',
    validation: process.env.ERC8004_BASE_VALIDATION_ADDRESS ?? '0x0000000000000000000000000000000000001002',
  },
  sepolia: {
    reputation: process.env.ERC8004_SEPOLIA_REPUTATION_ADDRESS ?? '0x0000000000000000000000000000000000002000',
    identity: process.env.ERC8004_SEPOLIA_IDENTITY_ADDRESS ?? '0x0000000000000000000000000000000000002001',
    validation: process.env.ERC8004_SEPOLIA_VALIDATION_ADDRESS ?? '0x0000000000000000000000000000000000002002',
  },
};

const RPC_ENDPOINTS: Record<Network, string> = {
  base: process.env.RPC_URL_BASE ?? '',
  sepolia: process.env.RPC_URL_SEPOLIA ?? '',
};

export function buildAgentId(owner: string, handle: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(`${owner}:${handle}`));
}

function getReputationAddress(network: Network) {
  return ADDRESS_MAP[network].reputation;
}

export async function fetchReputationScore(network: Network, agentId: string) {
  const rpcUrl = RPC_ENDPOINTS[network];
  if (!rpcUrl) {
    throw new Error(`RPC URL not configured for ${network}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new Contract(getReputationAddress(network), REP_ABI, provider);
  const raw = await contract.reputationScore(agentId);
  return Number(raw) / 1e18;
}

export async function updateReputationWithFeedback(
  signer: ethers.Signer,
  network: Network,
  agentId: string,
  score: number,
) {
  const contract = new Contract(getReputationAddress(network), REP_ABI, signer);
  const scaled = ethers.parseUnits(score.toString(), 18);
  const tx = await contract.updateReputation(agentId, scaled);
  return tx.wait();
}

export async function logValidationEvidence(signer: ethers.Signer, network: Network, agentId: string, payload: string) {
  const validationAddress = ADDRESS_MAP[network].validation;
  const contract = new Contract(validationAddress, VALIDATION_ABI, signer);
  return contract.logEvidence(agentId, payload);
}
