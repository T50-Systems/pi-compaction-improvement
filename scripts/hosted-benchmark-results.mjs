import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const SUMMARY_SAFETY_BOUND_MS = 250;
export const POLICY_P99_TARGET_MS = 5;

const summaryPaths = [
	"assembly",
	"verification",
	"complete",
	"aggressive",
	"invalidFallback",
	"timeoutFallback",
	"abortFallback",
];
const memoryLabels = ["representative", "near-context-limit"];
const numericMemoryFields = [
	"messageCount",
	"heapUsedBeforeBytes",
	"heapUsedAfterBytes",
	"heapDeltaBytes",
	"observedPeakHeapBytes",
	"rssBeforeBytes",
	"rssAfterBytes",
	"rssDeltaBytes",
	"observedPeakRssBytes",
];
const numericPolicyFields = [
	"hz",
	"min",
	"max",
	"mean",
	"p75",
	"p99",
	"p995",
	"p999",
	"rme",
	"sampleCount",
];

function requireFiniteNumber(value, pathName) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${pathName} must be a finite number`);
	}
	return value;
}

function requireObject(value, pathName) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${pathName} must be an object`);
	}
	return value;
}

export function parseTaggedJson(output, tag) {
	const prefix = `${tag} `;
	const matchingLines = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith(prefix));
	if (matchingLines.length !== 1) {
		throw new Error(`expected exactly one ${tag} record, found ${matchingLines.length}`);
	}
	return JSON.parse(matchingLines[0].slice(prefix.length));
}

export function normalizeSummaryProfile(value) {
	const input = requireObject(value, "SUMMARY_PROFILE");
	return Object.fromEntries(
		summaryPaths.map((name) => {
			const record = requireObject(input[name], `SUMMARY_PROFILE.${name}`);
			return [
				name,
				{
					p50Ms: requireFiniteNumber(record.p50Ms, `${name}.p50Ms`),
					p95Ms: requireFiniteNumber(record.p95Ms, `${name}.p95Ms`),
					p99Ms: requireFiniteNumber(record.p99Ms, `${name}.p99Ms`),
					samples: requireFiniteNumber(record.samples, `${name}.samples`),
				},
			];
		}),
	);
}

export function normalizeSummaryMemory(value) {
	if (!Array.isArray(value)) throw new Error("SUMMARY_MEMORY must be an array");
	const byLabel = new Map(value.map((record) => [record?.label, record]));
	return memoryLabels.map((label) => {
		const input = requireObject(byLabel.get(label), `SUMMARY_MEMORY.${label}`);
		return {
			label,
			...Object.fromEntries(
				numericMemoryFields.map((field) => [
					field,
					requireFiniteNumber(input[field], `${label}.${field}`),
				]),
			),
		};
	});
}

export function normalizeSummaryPolicy(value) {
	const input = requireObject(value, "SUMMARY_POLICY");
	const boundMs = requireFiniteNumber(input.boundMs, "SUMMARY_POLICY.boundMs");
	if (boundMs !== SUMMARY_SAFETY_BOUND_MS) {
		throw new Error(`SUMMARY_POLICY bound changed from ${SUMMARY_SAFETY_BOUND_MS} ms`);
	}
	const paths = requireObject(input.paths, "SUMMARY_POLICY.paths");
	const normalizedPaths = Object.fromEntries(
		["complete", "timeoutFallback", "abortFallback"].map((name) => {
			const result = requireObject(paths[name], `SUMMARY_POLICY.paths.${name}`);
			const p99Ms = requireFiniteNumber(result.p99Ms, `${name}.p99Ms`);
			return [name, { p99Ms, passed: p99Ms < boundMs }];
		}),
	);
	return {
		boundMs,
		kind: "non-network-safety-bound",
		finalSlo: false,
		paths: normalizedPaths,
		passed: Object.values(normalizedPaths).every((result) => result.passed),
	};
}

export function normalizePolicyReport(value) {
	const input = requireObject(value, "policy report");
	if (!Array.isArray(input.files)) throw new Error("policy report files must be an array");
	const results = input.files.flatMap((file) => {
		if (!Array.isArray(file?.groups)) return [];
		return file.groups.flatMap((group) => {
			if (!Array.isArray(group?.benchmarks)) return [];
			return group.benchmarks.map((benchmark) => ({
				name: String(benchmark.name),
				...Object.fromEntries(
					numericPolicyFields.map((field) => [
						field,
						requireFiniteNumber(benchmark[field], `policy.${benchmark.name}.${field}`),
					]),
				),
			}));
		});
	});
	if (results.length === 0) throw new Error("policy report contained no benchmark results");
	return results.sort((left, right) => left.name.localeCompare(right.name));
}

export function buildPolicyResult(profile) {
	const paths = profile.map(({ name, p99 }) => ({
		name,
		p99Ms: p99,
		passed: p99 < POLICY_P99_TARGET_MS,
	}));
	return {
		targetP99Ms: POLICY_P99_TARGET_MS,
		kind: "existing-perf-1-policy-target",
		paths,
		passed: paths.every((pathResult) => pathResult.passed),
	};
}

let validateArtifactPromise;
export async function validateHostedBenchmarkArtifact(artifact) {
	if (!validateArtifactPromise) {
		validateArtifactPromise = (async () => {
			const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
			const schema = JSON.parse(
				await readFile(
					path.join(scriptDirectory, "schemas", "hosted-benchmark-results.schema.json"),
					"utf8",
				),
			);
			return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
		})();
	}
	const validate = await validateArtifactPromise;
	if (validate(artifact)) return [];
	return (validate.errors ?? []).map(
		(error) => `${error.instancePath || "$"} ${error.message}`,
	);
}
