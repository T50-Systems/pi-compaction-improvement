#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	POLICY_P99_TARGET_MS,
	SUMMARY_REGRESSION_BUDGET_MS,
	SUMMARY_REGRESSION_EVIDENCE_RUN_ID,
	SUMMARY_SAFETY_BOUND_MS,
	buildPolicyResult,
	normalizePolicyReport,
	normalizeSummaryMemory,
	normalizeSummaryPolicy,
	normalizeSummaryProfile,
	normalizeSummaryRegressionPolicy,
	parseTaggedJson,
	validateHostedBenchmarkArtifact,
} from "./hosted-benchmark-results.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const vitestCli = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

function parsePositiveInteger(value, option) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
		throw new Error(`${option} must be an integer from 1 through 20`);
	}
	return parsed;
}

export function parseArguments(argv, env = process.env) {
	let repetitions = parsePositiveInteger(env.BENCHMARK_REPETITIONS ?? "5", "repetitions");
	let outputDirectory = path.join(repositoryRoot, "benchmark-results", "hosted");
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--runs") {
			repetitions = parsePositiveInteger(argv[++index], "--runs");
		} else if (argument === "--output") {
			const output = argv[++index];
			if (!output) throw new Error("--output requires a directory");
			outputDirectory = path.resolve(repositoryRoot, output);
		} else {
			throw new Error(`unknown argument: ${argument}`);
		}
	}
	return { repetitions, outputDirectory };
}

function nullableEnvironmentValue(env, name) {
	return env[name] ? String(env[name]) : null;
}

export async function collectMetadata(env = process.env) {
	const vitestPackage = JSON.parse(
		await readFile(path.join(repositoryRoot, "node_modules", "vitest", "package.json"), "utf8"),
	);
	const runAttempt = env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : null;
	return {
		runner: env.BENCHMARK_RUNNER_LABEL ?? env.RUNNER_OS ?? "local",
		os: `${env.RUNNER_OS ?? os.platform()} ${os.release()}`,
		arch: env.RUNNER_ARCH ?? process.arch,
		node: process.version,
		vitest: String(vitestPackage.version),
		repository: nullableEnvironmentValue(env, "GITHUB_REPOSITORY"),
		commit: nullableEnvironmentValue(env, "GITHUB_SHA"),
		workflowRunId: nullableEnvironmentValue(env, "GITHUB_RUN_ID"),
		workflowRunAttempt: Number.isInteger(runAttempt) && runAttempt >= 1 ? runAttempt : null,
	};
}

async function runVitest(argumentsList) {
	return execFileAsync(process.execPath, [vitestCli, ...argumentsList], {
		cwd: repositoryRoot,
		env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
		maxBuffer: 20_000_000,
		windowsHide: true,
	});
}

function safeLogRecord(tag, value) {
	return `${tag} ${JSON.stringify(value)}`;
}

async function writeEvidence(outputDirectory, artifact, logLines) {
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(
		path.join(outputDirectory, "hosted-benchmark.log"),
		`${logLines.join("\n")}\n`,
		"utf8",
	);
	if (artifact.runs.length === 0) return;
	const errors = await validateHostedBenchmarkArtifact(artifact);
	if (errors.length > 0) {
		throw new Error(`hosted benchmark artifact failed schema validation:\n${errors.join("\n")}`);
	}
	await writeFile(
		path.join(outputDirectory, "hosted-benchmark-results.json"),
		`${JSON.stringify(artifact, null, 2)}\n`,
		"utf8",
	);
}

export async function runHostedBenchmarks({ repetitions, outputDirectory }, env = process.env) {
	const metadata = await collectMetadata(env);
	const artifact = {
		schemaVersion: 1,
		metadata,
		configuration: {
			repetitions,
			provider: "deterministic-fake",
			networkCalls: false,
			summarySafetyBoundMs: SUMMARY_SAFETY_BOUND_MS,
			summaryRegressionBudgetMs: SUMMARY_REGRESSION_BUDGET_MS,
			summaryRegressionEvidenceRunId: SUMMARY_REGRESSION_EVIDENCE_RUN_ID,
			finalSummarySloSelected: false,
		},
		runs: [],
	};
	const logLines = [safeLogRecord("HOSTED_BENCHMARK_METADATA", metadata)];
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pi-compaction-benchmark-"));
	let failure;
	try {
		for (let iteration = 1; iteration <= repetitions; iteration += 1) {
			const policyOutput = path.join(temporaryDirectory, `policy-${iteration}.json`);
			console.log(`Hosted benchmark repetition ${iteration}/${repetitions}`);
			const summary = await runVitest([
				"run",
				"--config",
				"vitest.profile.config.ts",
			]);
			const summaryProfile = normalizeSummaryProfile(
				parseTaggedJson(summary.stdout, "SUMMARY_PROFILE"),
			);
			const summaryMemory = normalizeSummaryMemory(
				parseTaggedJson(summary.stdout, "SUMMARY_MEMORY"),
			);
			const summaryPolicy = normalizeSummaryPolicy(
				parseTaggedJson(summary.stdout, "SUMMARY_POLICY"),
			);
			const summaryRegressionPolicy = normalizeSummaryRegressionPolicy(
				parseTaggedJson(summary.stdout, "SUMMARY_REGRESSION_POLICY"),
			);
			const policy = await runVitest([
				"bench",
				"--run",
				"--outputJson",
				policyOutput,
			]);
			const policyProfile = normalizePolicyReport(
				JSON.parse(await readFile(policyOutput, "utf8")),
			);
			const policyResult = buildPolicyResult(policyProfile);
			const record = {
				iteration,
				SUMMARY_PROFILE: summaryProfile,
				SUMMARY_MEMORY: summaryMemory,
				SUMMARY_POLICY: summaryPolicy,
				SUMMARY_REGRESSION_POLICY: summaryRegressionPolicy,
				POLICY_PROFILE: policyProfile,
				POLICY_RESULT: policyResult,
			};
			artifact.runs.push(record);
			logLines.push(`REPETITION ${iteration}/${repetitions}`);
			for (const tag of [
				"SUMMARY_PROFILE",
				"SUMMARY_MEMORY",
				"SUMMARY_POLICY",
				"SUMMARY_REGRESSION_POLICY",
				"POLICY_PROFILE",
				"POLICY_RESULT",
			]) {
				logLines.push(safeLogRecord(tag, record[tag]));
			}
			logLines.push(`REPETITION_RESULT ${iteration} PASS`);
			console.log(
				`Repetition ${iteration} passed: regression < ${SUMMARY_REGRESSION_BUDGET_MS} ms; safety < ${SUMMARY_SAFETY_BOUND_MS} ms; policy < ${POLICY_P99_TARGET_MS} ms`,
			);
			if (summary.stderr.trim()) console.warn("Summary benchmark emitted non-fatal stderr.");
			if (policy.stderr.trim()) console.warn("Policy benchmark emitted non-fatal stderr.");
		}
	} catch (error) {
		failure = error;
		logLines.push(`BENCHMARK_RESULT FAIL completed=${artifact.runs.length} requested=${repetitions}`);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
		await writeEvidence(outputDirectory, artifact, logLines);
	}
	if (failure) throw failure;
	logLines.push(`BENCHMARK_RESULT PASS completed=${artifact.runs.length}`);
	await writeEvidence(outputDirectory, artifact, logLines);
	return artifact;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	try {
		await runHostedBenchmarks(parseArguments(process.argv.slice(2)));
	} catch (error) {
		console.error(
			`Hosted benchmark collection failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
