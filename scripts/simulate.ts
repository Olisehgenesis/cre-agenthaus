import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import dotenv from 'dotenv'

const repoRoot = resolve('/Users/olisehgenesis/Desktop/Code/chainlink')
const workflowDir = resolve(repoRoot, 'agent-hause', 'erc8004')
const configPath = resolve(workflowDir, 'config.staging.json')
const creProjectRoot = resolve(repoRoot, 'agent-hause')

const creBin =
	process.env.CRE_BIN || resolve(process.env.HOME ?? '', '.cre', 'bin', 'cre')
const bunBin = process.env.BUN_BIN || resolve(process.env.HOME ?? '', '.bun', 'bin', 'bun')

const envPath = process.env.ENV_PATH || resolve(repoRoot, '.env')
const env = dotenv.config({ path: envPath }).parsed ?? {}

const feedOracleKey = env.FEEDORACLE_API_KEY || process.env.FEEDORACLE_API_KEY || ''
const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY || ''

if (!feedOracleKey || !groqKey) {
	console.error('Missing FEEDORACLE_API_KEY or GROQ_API_KEY in env')
	process.exit(1)
}

const original = readFileSync(configPath, 'utf8')
const config = JSON.parse(original) as Record<string, unknown>

config.feedOracleApiKey = feedOracleKey
config.groq = {
	...(typeof config.groq === 'object' && config.groq ? config.groq : {}),
	apiKey: groqKey,
}

writeFileSync(configPath, JSON.stringify(config, null, 2))

try {
	const result = spawnSync(
		creBin,
		[
			'--project-root',
			creProjectRoot,
			'--target',
			'staging-settings',
			'workflow',
			'simulate',
			'./erc8004',
		],
		{
			cwd: creProjectRoot,
			stdio: 'inherit',
			env: {
				...process.env,
				PATH: `${resolve(process.env.HOME ?? '', '.bun', 'bin')}:${process.env.PATH ?? ''}`,
				BUN_INSTALL: resolve(process.env.HOME ?? '', '.bun'),
			},
		},
	)

	if (result.error) throw result.error
	process.exit(result.status ?? 0)
} finally {
	writeFileSync(configPath, original)
}
