#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { AgentRecord, sampleAgents, workflowTemplates } from './data/sampleAgents';
import { buildAgentId, fetchReputationScore, updateReputationWithFeedback } from './lib/erc8004';
import { queueCreWorkflow } from './lib/cre';
import { fetchEthUsdPrice } from './lib/api';
import { ethers } from 'ethers';

const program = new Command();

program
  .name('agent-cli')
  .description('Manage ERC-8004 agents and trigger Chainlink CRE workflows from the terminal.')
  .version('1.0.0');

const describeAgent = (agent: AgentRecord) =>
  `${agent.id.padEnd(6)}  ${agent.name.padEnd(22)}  ${agent.network.padEnd(6)}  rep=${Math.round(
    agent.reputationScore * 100,
  )}%  cap=$${agent.spendingCapUsd.toLocaleString()}`;

program
  .command('list')
  .description('Show the registered agents and their reputations.')
  .option('-n, --network <network>', 'limit agents to a specific network')
  .action((options) => {
    const entries = options.network
      ? sampleAgents.filter((agent) => agent.network === options.network)
      : sampleAgents;

    if (entries.length === 0) {
      console.log('No agents match that filter.');
      return;
    }

    console.log('ID     Name                   Chain   Reputation   Cap');
    console.log('-------------------------------------------------------');
    entries.forEach((agent) => console.log(describeAgent(agent)));
  });

program
  .command('templates')
  .description('List the workflow templates you can run.')
  .action(() => {
    workflowTemplates.forEach((template) => {
      console.log(`${template.id}: ${template.name} (trust threshold ${Math.round(template.trustThreshold * 100)}%)`);
    });
  });

program
  .command('run')
  .description('Fetch the reputation window for an agent and queue the CRE workflow.')
  .requiredOption('-a, --agent <agentId>', 'agent identifier (e.g., AG-001)')
  .requiredOption('-w, --workflow <workflowId>', 'workflow template id (e.g., wf-erc8004-check)')
  .option('-d, --dry-run', 'skip the CRE API call and only compute throttles')
  .action(async (options) => {
    const agent = sampleAgents.find((item) => item.id === options.agent);
    if (!agent) {
      console.error(`agent ${options.agent} not found in registry`);
      process.exitCode = 1;
      return;
    }

    const template = workflowTemplates.find((item) => item.id === options.workflow);
    if (!template) {
      console.error(`workflow template ${options.workflow} is unknown`);
      process.exitCode = 1;
      return;
    }

    const agentId = buildAgentId(agent.owner, agent.handle);
    let reputationScore = agent.reputationScore;

    try {
      reputationScore = await fetchReputationScore(agent.network, agentId);
    } catch (error) {
      console.error('unable to read reputation score:', (error as Error).message);
      process.exitCode = 1;
      return;
    }

    const throttled = reputationScore < template.trustThreshold;
    const adjustedCap = throttled ? Math.round(agent.spendingCapUsd * 0.55) : agent.spendingCapUsd;

    console.log(`agent=${agent.id}
  workflow=${template.id}
  reputation=${(reputationScore * 100).toFixed(2)}%
  trustThreshold=${template.trustThreshold * 100}%
  throttled=${throttled}
  adjustedCap=$${adjustedCap.toLocaleString()}`);

    if (options.dryRun) {
      console.log('Dry run enabled, skipping CRE API call.');
      return;
    }

    try {
      const creResponse = await queueCreWorkflow({
        agentId,
        templateId: template.id,
        payload: {
          agentHandle: agent.handle,
          reputationScore,
          throttled,
          trustThreshold: template.trustThreshold,
          spendingCapUsd: adjustedCap,
        },
        network: agent.network,
      });

      console.log('CRE workflow queued, response:');
      console.log(JSON.stringify(creResponse, null, 2));
    } catch (error) {
      console.error('failed to queue CRE workflow:', (error as Error).message);
      process.exitCode = 1;
    }
  });

// additional helper commands ------------------------------------------------

program
  .command('grant')
  .description('Grant or update ERC-8004 reputation for an agent')
  .requiredOption('-a, --agent <agentId>', 'agent identifier (e.g., AG-001)')
  .requiredOption('-s, --score <score>', 'new reputation score 0..1')
  .option('-n, --network <network>', 'network (base or sepolia)', 'sepolia')
  .action(async (opts) => {
    const agent = sampleAgents.find((item) => item.id === opts.agent);
    if (!agent) {
      console.error(`agent ${opts.agent} not found`);
      process.exitCode = 1;
      return;
    }
    const score = parseFloat(opts.score);
    if (isNaN(score) || score < 0 || score > 1) {
      console.error('score must be a number between 0 and 1');
      process.exitCode = 1;
      return;
    }

    const net = opts.network as 'base' | 'sepolia';
    const rpc = process.env[`RPC_URL_${net.toUpperCase()}`];
    const pk = process.env[`PRIVATE_KEY_${net.toUpperCase()}`];
    if (!rpc || !pk) {
      console.error('RPC_URL_<NETWORK> and PRIVATE_KEY_<NETWORK> must be set in env');
      process.exitCode = 1;
      return;
    }

    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(pk, provider);
    const agentId = buildAgentId(agent.owner, agent.handle);

    try {
      await updateReputationWithFeedback(wallet, net, agentId, score);
      console.log(`reputation for ${agent.id} updated to ${score}`);
    } catch (err) {
      console.error('failed to update reputation:', (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('fetch-price')
  .description('Fetch ETH/USD price from Coingecko (example off-chain API)')
  .action(async () => {
    try {
      const price = await fetchEthUsdPrice();
      console.log('ETH price (USD):', price);
    } catch (err) {
      console.error('error fetching price:', (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('write-price')
  .description('Write a price to a simple on-chain oracle contract')
  .requiredOption('-c, --contract <address>', 'oracle contract address')
  .requiredOption('-n, --network <network>', 'network (base or sepolia)', 'sepolia')
  .action(async (opts) => {
    const net = opts.network as 'base' | 'sepolia';
    const rpc = process.env[`RPC_URL_${net.toUpperCase()}`];
    const pk = process.env[`PRIVATE_KEY_${net.toUpperCase()}`];
    if (!rpc || !pk) {
      console.error('RPC_URL_<NETWORK> and PRIVATE_KEY_<NETWORK> must be set in env');
      process.exitCode = 1;
      return;
    }

    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(pk, provider);
    try {
      const price = await fetchEthUsdPrice();
      const abi = [
        'function setPrice(uint256 price)',
        'function getPrice() view returns (uint256)',
      ];
      const contract = new ethers.Contract(opts.contract, abi, wallet);
      const tx = await contract.setPrice(ethers.parseUnits(price.toString(), 0));
      await tx.wait();
      console.log('price written to contract', opts.contract, price);
    } catch (err) {
      console.error('failed to write price:', (err as Error).message);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
