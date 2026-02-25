import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	handler,
	CronCapability,
	EVMClient,
	HTTPClient,
	type EVMLog,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	hexToBase64,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	Runner,
	type Runtime,
	type NodeRuntime,
	consensusMedianAggregation,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { z } from 'zod'
import { BalanceReader, IERC20, MessageEmitter, ReserveManager } from '../contracts/abi'

const configSchema = z.object({
	schedule: z.string(),
	url: z.string(),
	apiUrl: z.string().optional(), // optional API endpoint for offchain fetch example
	feedOracleUrl: z.string().optional(),
	feedOracleApiKey: z.string().optional(),
	feedOracleSymbols: z.array(z.string()).optional(),
	feedOracleMaxStalenessSeconds: z.number().optional(),
	dryRun: z.boolean().optional(),
	riskThresholds: z
		.object({
			reserveRatioMin: z.number().optional(),
			pegDeviationMax: z.number().optional(),
			scoreMin: z.number().optional(),
			healthScoreMin: z.number().optional(),
		})
		.optional(),
	groq: z
		.object({
			apiUrl: z.string().optional(),
			apiKey: z.string().optional(),
			model: z.string().optional(),
			temperature: z.number().optional(),
			maxTokens: z.number().optional(),
		})
		.optional(),
	evms: z.array(
		z.object({
			tokenAddress: z.string(),
			porAddress: z.string(),
			proxyAddress: z.string(),
			balanceReaderAddress: z.string(),
			messageEmitterAddress: z.string(),
			chainSelectorName: z.string(),
			gasLimit: z.string(),
			symbol: z.string().optional(),
		}),
	),
})

type Config = z.infer<typeof configSchema>

interface PORResponse {
	accountName: string
	totalTrust: number
	totalToken: number
	ripcord: boolean
	updatedAt: string
}

interface ReserveInfo {
	lastUpdated: Date
	totalReserve: number
}

interface FeedOracleRisk {
	symbol: string
	reserveRatio: number | null
	pegDeviation: number | null
	score: number | null
	healthScore: number | null
	raw: Record<string, unknown>
}

interface FeedOracleSnapshot {
	asOf: string
	assets: FeedOracleRisk[]
	rawCount: number
}

interface GroqDecision {
	riskLevel: 'low' | 'medium' | 'high'
	allowUpdate: boolean
	summary: string
	flags: string[]
}

const FEEDORACLE_STABLECOIN_URL = 'https://api.feedoracle.io/api/v1/feeds/stablecoin'

const normalizeNumber = (value: unknown): number | null => {
	if (value === null || value === undefined) return null
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const cleaned = value.trim().replace(/%$/, '')
		const parsed = Number(cleaned)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

const numberFromUnknown = z.preprocess((value) => normalizeNumber(value), z.number().nullable())

const feedOracleAssetSchema = z
	.object({
		symbol: z.string(),
		reserveRatio: numberFromUnknown.optional().nullable(),
		pegDeviation: numberFromUnknown.optional().nullable(),
		score: numberFromUnknown.optional().nullable(),
		healthScore: numberFromUnknown.optional().nullable(),
	})
	.passthrough()

const feedOracleResponseSchema = z
	.object({
		data: z.array(feedOracleAssetSchema),
	})
	.passthrough()

const groqDecisionSchema = z.object({
	riskLevel: z.enum(['low', 'medium', 'high']),
	allowUpdate: z.boolean(),
	summary: z.string(),
	flags: z.array(z.string()).default([]),
})

// Utility function to safely stringify objects with bigints
const safeJsonStringify = (obj: any): string =>
	JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)

const takeFirst = <T>(values: T[]): T => values[0]

const buildFeedOracleRisk = (asset: z.infer<typeof feedOracleAssetSchema>): FeedOracleRisk => {
	const raw = JSON.parse(JSON.stringify(asset)) as Record<string, unknown>
	return {
		symbol: asset.symbol,
		reserveRatio: asset.reserveRatio ?? normalizeNumber(raw['reserve_ratio']) ?? null,
		pegDeviation: asset.pegDeviation ?? normalizeNumber(raw['peg_dev_pct']) ?? null,
		score: asset.score ?? normalizeNumber(raw['score']) ?? null,
		healthScore: asset.healthScore ?? normalizeNumber(raw['health_score']) ?? null,
		raw,
	}
}

const getFeedOracleApiKey = (runtime: Runtime<Config>): string =>
	runtime.config.feedOracleApiKey || ''

const getGroqApiKey = (runtime: Runtime<Config>): string => runtime.config.groq?.apiKey || ''


const fetchReserveInfo = (sendRequester: HTTPSendRequester, config: Config): ReserveInfo => {
	const response = sendRequester.sendRequest({ method: 'GET', url: config.url }).result()

	if (response.statusCode !== 200) {
		throw new Error(`HTTP request failed with status: ${response.statusCode}`)
	}

	const responseText = Buffer.from(response.body).toString('utf-8')
	const porResp: PORResponse = JSON.parse(responseText)

	if (porResp.ripcord) {
		throw new Error('ripcord is true')
	}

	return {
		lastUpdated: new Date(porResp.updatedAt),
		totalReserve: porResp.totalToken,
	}
}

const fetchFeedOracleSnapshot = (
	nodeRuntime: NodeRuntime<Config>,
	requestJson: string,
): string => {
	const request = JSON.parse(requestJson) as {
		url: string
		apiKey: string
		symbols?: string[] | null
	}
	const httpClient = new HTTPClient()
	const resp = httpClient
		.sendRequest(nodeRuntime, {
			method: 'GET',
			url: request.url,
			headers: {
				'X-API-Key': request.apiKey,
			},
		})
		.result()

	if (resp.statusCode !== 200) {
		const bodyText = new TextDecoder().decode(resp.body)
		throw new Error(`FeedOracle request failed: ${resp.statusCode} ${bodyText}`)
	}

	const responseText = new TextDecoder().decode(resp.body)
	const payload = feedOracleResponseSchema.parse(JSON.parse(responseText))
	const symbols = request.symbols ?? null
	const filtered =
		symbols && symbols.length > 0
			? payload.data.filter((asset) => symbols.includes(asset.symbol))
			: payload.data

	const snapshot: FeedOracleSnapshot = {
		asOf: new Date().toISOString(),
		assets: filtered.map(buildFeedOracleRisk),
		rawCount: payload.data.length,
	}

	return JSON.stringify(snapshot)
}

const getFeedOracleSymbols = (runtime: Runtime<Config>): string[] | undefined => {
	const explicit = runtime.config.feedOracleSymbols ?? []
	const fromEvms = runtime.config.evms.map((evm) => evm.symbol).filter(Boolean) as string[]
	const merged = [...new Set([...explicit, ...fromEvms])]
	return merged.length > 0 ? merged : undefined
}

const parseUpdatedAt = (value: unknown): Date | null => {
	if (!value) return null
	if (value instanceof Date) return value
	if (typeof value === 'number' && Number.isFinite(value)) {
		const millis = value > 1e12 ? value : value * 1000
		const date = new Date(millis)
		return Number.isNaN(date.getTime()) ? null : date
	}
	if (typeof value === 'string') {
		const date = new Date(value)
		return Number.isNaN(date.getTime()) ? null : date
	}
	return null
}

const evaluateFeedOracleSnapshot = (
	snapshot: FeedOracleSnapshot,
	thresholds: Config['riskThresholds'],
	maxStalenessSeconds?: number,
): { allowUpdate: boolean; flags: string[]; summary: string } => {
	const flags: string[] = []
	const reserveRatioMin = thresholds?.reserveRatioMin
	const pegDeviationMax = thresholds?.pegDeviationMax
	const scoreMin = thresholds?.scoreMin
	const healthScoreMin = thresholds?.healthScoreMin
	const now = Date.now()

	for (const asset of snapshot.assets) {
		if (reserveRatioMin !== undefined && asset.reserveRatio !== null) {
			if (asset.reserveRatio < reserveRatioMin) {
				flags.push(`reserveRatio below min for ${asset.symbol}: ${asset.reserveRatio}`)
			}
		}
		if (pegDeviationMax !== undefined && asset.pegDeviation !== null) {
			if (Math.abs(asset.pegDeviation) > pegDeviationMax) {
				flags.push(`pegDeviation above max for ${asset.symbol}: ${asset.pegDeviation}`)
			}
		}
		if (scoreMin !== undefined && asset.score !== null) {
			if (asset.score < scoreMin) {
				flags.push(`score below min for ${asset.symbol}: ${asset.score}`)
			}
		}
		if (healthScoreMin !== undefined && asset.healthScore !== null) {
			if (asset.healthScore < healthScoreMin) {
				flags.push(`healthScore below min for ${asset.symbol}: ${asset.healthScore}`)
			}
		}
		if (maxStalenessSeconds !== undefined) {
			const updatedAt =
				parseUpdatedAt(asset.raw['updatedAt']) ??
				parseUpdatedAt(asset.raw['lastUpdated']) ??
				parseUpdatedAt(asset.raw['timestamp'])
			const baseline = updatedAt ?? new Date(snapshot.asOf)
			const ageSeconds = Math.floor((now - baseline.getTime()) / 1000)
			if (ageSeconds > maxStalenessSeconds) {
				flags.push(`stale feed for ${asset.symbol}: ${ageSeconds}s`)
			}
		}
	}

	const allowUpdate = flags.length === 0
	const summary = allowUpdate
		? 'FeedOracle snapshot within thresholds.'
		: `FeedOracle snapshot failed thresholds: ${flags.join('; ')}`

	return { allowUpdate, flags, summary }
}

const createGroqPrompt = (context: {
	onChain: {
		totalSupply: string
		totalReserveScaled: string
		nativeTokenBalance: string
	}
	feedOracle: FeedOracleSnapshot | null
}) => {
	return [
		'You are a risk analyst for a stablecoin proof-of-reserves workflow.',
		'Review the on-chain totals and optional FeedOracle snapshot.',
		'Return ONLY raw JSON with keys: riskLevel (low|medium|high), allowUpdate (boolean), summary (string), flags (string array).',
		'Do not wrap the JSON in code fences or markdown.',
		'Decide allowUpdate=false if there are clear anomalies, missing data, or severe peg/reserve issues.',
		`Context: ${safeJsonStringify(context)}`,
	].join('\n')
}

const extractJsonFromText = (content: string): string => {
	const fenced = content.match(/```json\\s*([\\s\\S]*?)```/i)
	if (fenced?.[1]) return fenced[1].trim()
	const genericFence = content.match(/```\\s*([\\s\\S]*?)```/i)
	if (genericFence?.[1]) return genericFence[1].trim()

	const firstBrace = content.indexOf('{')
	const lastBrace = content.lastIndexOf('}')
	if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
		return content.slice(firstBrace, lastBrace + 1)
	}

	return content
}

const fetchGroqDecision = (
	nodeRuntime: NodeRuntime<Config>,
	request: {
		apiUrl: string
		apiKey: string
		model: string
		temperature: number
		maxTokens: number
		prompt: string
	},
): GroqDecision => {
	const httpClient = new HTTPClient()
	const body = JSON.stringify({
		model: request.model,
		messages: [
			{ role: 'system', content: 'Return only JSON as specified.' },
			{ role: 'user', content: request.prompt },
		],
		temperature: request.temperature,
		max_tokens: request.maxTokens,
	})
	const bodyBase64 = Buffer.from(body).toString('base64')

	const resp = httpClient
		.sendRequest(nodeRuntime, {
			method: 'POST',
			url: request.apiUrl,
			headers: {
				Authorization: `Bearer ${request.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: bodyBase64,
		})
		.result()

	if (resp.statusCode !== 200) {
		const bodyText = new TextDecoder().decode(resp.body)
		throw new Error(`Groq request failed: ${resp.statusCode} ${bodyText}`)
	}

	const responseText = new TextDecoder().decode(resp.body)
	const payload = JSON.parse(responseText)
	const content = payload?.choices?.[0]?.message?.content
	if (!content || typeof content !== 'string') {
		throw new Error('Groq response missing content')
	}

	let parsedContent: unknown
	try {
		parsedContent = JSON.parse(extractJsonFromText(content))
	} catch (error) {
		throw new Error(`Groq response was not valid JSON: ${(error as Error).message}`)
	}

	return groqDecisionSchema.parse(parsedContent)
}

const fetchNativeTokenBalance = (
	runtime: Runtime<Config>,
	evmConfig: Config['evms'][0],
	tokenHolderAddress: string,
): bigint => {
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	// Encode the contract call data for getNativeBalances
	const callData = encodeFunctionData({
		abi: BalanceReader,
		functionName: 'getNativeBalances',
		args: [[tokenHolderAddress as Address]],
	})

	const contractCall = evmClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: evmConfig.balanceReaderAddress as Address,
				data: callData,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	// Decode the result
	const balances = decodeFunctionResult({
		abi: BalanceReader,
		functionName: 'getNativeBalances',
		data: bytesToHex(contractCall.data),
	})

	if (!balances || balances.length === 0) {
		throw new Error('No balances returned from contract')
	}

	return balances[0]
}

const getTotalSupply = (runtime: Runtime<Config>): bigint => {
	const evms = runtime.config.evms
	let totalSupply = 0n

	for (const evmConfig of evms) {
		const network = getNetwork({
			chainFamily: 'evm',
			chainSelectorName: evmConfig.chainSelectorName,
			isTestnet: true,
		})

		if (!network) {
			throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
		}

		const evmClient = new EVMClient(network.chainSelector.selector)

		// Encode the contract call data for totalSupply
		const callData = encodeFunctionData({
			abi: IERC20,
			functionName: 'totalSupply',
		})

		const contractCall = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: evmConfig.tokenAddress as Address,
					data: callData,
				}),
				blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
			})
			.result()

		// Decode the result
		const supply = decodeFunctionResult({
			abi: IERC20,
			functionName: 'totalSupply',
			data: bytesToHex(contractCall.data),
		})

		totalSupply += supply
	}

	return totalSupply
}

const updateReserves = (
	runtime: Runtime<Config>,
	totalSupply: bigint,
	totalReserveScaled: bigint,
): string => {
	const evmConfig = runtime.config.evms[0]
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	runtime.log(
		`Updating reserves totalSupply ${totalSupply.toString()} totalReserveScaled ${totalReserveScaled.toString()}`,
	)

	// Encode the contract call data for updateReserves
	const callData = encodeFunctionData({
		abi: ReserveManager,
		functionName: 'updateReserves',
		args: [
			{
				totalMinted: totalSupply,
				totalReserve: totalReserveScaled,
			},
		],
	})

	// Step 1: Generate report using consensus capability
	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(callData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	const resp = evmClient
		.writeReport(runtime, {
			receiver: evmConfig.proxyAddress,
			report: reportResponse,
			gasConfig: {
				gasLimit: evmConfig.gasLimit,
			},
		})
		.result()

	const txStatus = resp.txStatus

	if (txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Failed to write report: ${resp.errorMessage || txStatus}`)
	}

	const txHash = resp.txHash || new Uint8Array(32)

	runtime.log(`Write report transaction succeeded at txHash: ${bytesToHex(txHash)}`)

	return txHash.toString()
}

// helper that demonstrates runInNodeMode/consensus pattern from docs
const fetchMathResult = (nodeRuntime: NodeRuntime<Config>): bigint => {
	const httpClient = new HTTPClient()
	const req = { url: nodeRuntime.config.apiUrl as string, method: 'GET' as const }
	const resp = httpClient.sendRequest(nodeRuntime, req).result()
	const bodyText = new TextDecoder().decode(resp.body)
	return BigInt(bodyText.trim())
}

const getFeedOracleSnapshot = (runtime: Runtime<Config>): FeedOracleSnapshot | null => {
	let apiKey = getFeedOracleApiKey(runtime)
	if (!apiKey) {
		runtime.log('FeedOracle API key not configured, skipping FeedOracle snapshot.')
		return null
	}

	const symbols = getFeedOracleSymbols(runtime) ?? []
	const request: { url: string; apiKey: string; symbols: string[] } = {
		url: runtime.config.feedOracleUrl ?? FEEDORACLE_STABLECOIN_URL,
		apiKey,
		symbols,
	}
	const requestJson = JSON.stringify(request)

	try {
		const responseJson = runtime
			.runInNodeMode(fetchFeedOracleSnapshot, takeFirst)
			(requestJson)
			.result()
		return JSON.parse(responseJson) as FeedOracleSnapshot
	} catch (error) {
		runtime.log(`FeedOracle snapshot failed: ${(error as Error).message}`)
		return null
	}
}

const getGroqDecision = (
	runtime: Runtime<Config>,
	context: {
		onChain: {
			totalSupply: string
			totalReserveScaled: string
			nativeTokenBalance: string
		}
		feedOracle: FeedOracleSnapshot | null
	},
): GroqDecision | null => {
	let apiKey = getGroqApiKey(runtime)
	if (!apiKey) {
		runtime.log('Groq API key not configured, skipping Groq analysis.')
		return null
	}

	const groqConfig = runtime.config.groq ?? {}
	const request = {
		apiUrl: groqConfig.apiUrl ?? 'https://api.groq.com/openai/v1/chat/completions',
		apiKey,
		model: groqConfig.model ?? 'llama-3.3-70b-versatile',
		temperature: groqConfig.temperature ?? 0.2,
		maxTokens: groqConfig.maxTokens ?? 512,
		prompt: createGroqPrompt(context),
	}

	try {
		return runtime
			.runInNodeMode(fetchGroqDecision, takeFirst)
			(request)
			.result()
	} catch (error) {
		runtime.log(`Groq decision failed: ${(error as Error).message}`)
		return null
	}
}

const doPOR = (runtime: Runtime<Config>): string => {
	runtime.log(`fetching por url ${runtime.config.url}`)

	// example offchain fetch using runInNodeMode if apiUrl provided
	if (runtime.config.apiUrl) {
		runtime.log('fetching random number via runInNodeMode')
		const randomVal = runtime
			.runInNodeMode(fetchMathResult, consensusMedianAggregation())()
			.result()
		runtime.log(`aggregated random value: ${randomVal}`)
	}

	const httpCapability = new HTTPClient()
	const reserveInfo = httpCapability
		.sendRequest(
			runtime,
			fetchReserveInfo,
			ConsensusAggregationByFields<ReserveInfo>({
				lastUpdated: median,
				totalReserve: median,
			}),
		)(runtime.config)
		.result()

	runtime.log(`ReserveInfo ${safeJsonStringify(reserveInfo)}`)

	const totalSupply = getTotalSupply(runtime)
	runtime.log(`TotalSupply ${totalSupply.toString()}`)

	const totalReserveScaled = BigInt(reserveInfo.totalReserve * 1e18)
	runtime.log(`TotalReserveScaled ${totalReserveScaled.toString()}`)

	const feedOracleSnapshot = getFeedOracleSnapshot(runtime)
	if (feedOracleSnapshot) {
		runtime.log(`FeedOracleSnapshot ${safeJsonStringify(feedOracleSnapshot)}`)
	}

	const nativeTokenBalance = fetchNativeTokenBalance(
		runtime,
		runtime.config.evms[0],
		runtime.config.evms[0].tokenAddress,
	)
	runtime.log(`NativeTokenBalance ${nativeTokenBalance.toString()}`)

	const decision = getGroqDecision(runtime, {
		onChain: {
			totalSupply: totalSupply.toString(),
			totalReserveScaled: totalReserveScaled.toString(),
			nativeTokenBalance: nativeTokenBalance.toString(),
		},
		feedOracle: feedOracleSnapshot,
	})

	if (feedOracleSnapshot && runtime.config.riskThresholds) {
		const evaluation = evaluateFeedOracleSnapshot(
			feedOracleSnapshot,
			runtime.config.riskThresholds,
			runtime.config.feedOracleMaxStalenessSeconds,
		)
		runtime.log(`RiskThresholds ${safeJsonStringify(evaluation)}`)
		if (!evaluation.allowUpdate) {
			runtime.log('Threshold gate blocked updateReserves; exiting without on-chain update.')
			return reserveInfo.totalReserve.toString()
		}
	}

	if (decision) {
		runtime.log(`GroqDecision ${safeJsonStringify(decision)}`)
		if (!decision.allowUpdate) {
			runtime.log('Groq decision blocked updateReserves; exiting without on-chain update.')
			return reserveInfo.totalReserve.toString()
		}
	}

	if (runtime.config.dryRun) {
		runtime.log('Dry-run enabled; skipping updateReserves.')
		return reserveInfo.totalReserve.toString()
	}

	updateReserves(runtime, totalSupply, totalReserveScaled)

	return reserveInfo.totalReserve.toString()
}

const getLastMessage = (
	runtime: Runtime<Config>,
	evmConfig: Config['evms'][0],
	emitter: string,
): string => {
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: evmConfig.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found for chain selector name: ${evmConfig.chainSelectorName}`)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	// Encode the contract call data for getLastMessage
	const callData = encodeFunctionData({
		abi: MessageEmitter,
		functionName: 'getLastMessage',
		args: [emitter as Address],
	})

	const contractCall = evmClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: evmConfig.messageEmitterAddress as Address,
				data: callData,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	// Decode the result
	const message = decodeFunctionResult({
		abi: MessageEmitter,
		functionName: 'getLastMessage',
		data: bytesToHex(contractCall.data),
	})

	return message
}

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error('Scheduled execution time is required')
	}

	runtime.log('Running CronTrigger')

	return doPOR(runtime)
}

const onLogTrigger = (runtime: Runtime<Config>, payload: EVMLog): string => {
	runtime.log('Running LogTrigger')

	const topics = payload.topics

	if (topics.length < 3) {
		runtime.log('Log payload does not contain enough topics')
		throw new Error(`log payload does not contain enough topics ${topics.length}`)
	}

	// topics[1] is a 32-byte topic, but the address is the last 20 bytes
	const emitter = bytesToHex(topics[1].slice(12))
	runtime.log(`Emitter ${emitter}`)

	const message = getLastMessage(runtime, runtime.config.evms[0], emitter)

	runtime.log(`Message retrieved from the contract ${message}`)

	return message
}

const initWorkflow = (config: Config) => {
	const cronTrigger = new CronCapability()
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.evms[0].chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(
			`Network not found for chain selector name: ${config.evms[0].chainSelectorName}`,
		)
	}

	const evmClient = new EVMClient(network.chainSelector.selector)

	return [
		handler(
			cronTrigger.trigger({
				schedule: config.schedule,
			}),
			onCronTrigger,
		),
		handler(
			evmClient.logTrigger({
				addresses: [config.evms[0].messageEmitterAddress],
			}),
			onLogTrigger,
		),
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({
		configSchema,
	})
	await runner.run(initWorkflow)
}
