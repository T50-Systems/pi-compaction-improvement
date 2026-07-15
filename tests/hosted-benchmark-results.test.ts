import { describe, expect, it } from "vitest";
import {
	buildPolicyResult,
	normalizePolicyReport,
	normalizeSummaryMemory,
	normalizeSummaryPolicy,
	normalizeSummaryProfile,
	parseTaggedJson,
	validateHostedBenchmarkArtifact,
} from "../scripts/hosted-benchmark-results.mjs";

const percentile = { p50Ms: 0.1, p95Ms: 0.2, p99Ms: 0.3, samples: 40 };
const rawSummaryProfile = {
	assembly: percentile,
	verification: percentile,
	complete: percentile,
	aggressive: percentile,
	invalidFallback: percentile,
	timeoutFallback: percentile,
	abortFallback: percentile,
};
const rawMemory = ["representative", "near-context-limit"].map((label, index) => ({
	label,
	messageCount: index === 0 ? 40 : 10_000,
	heapUsedBeforeBytes: 100,
	heapUsedAfterBytes: 110,
	heapDeltaBytes: 10,
	observedPeakHeapBytes: 110,
	rssBeforeBytes: 200,
	rssAfterBytes: 220,
	rssDeltaBytes: 20,
	observedPeakRssBytes: 220,
}));
const rawSummaryPolicy = {
	boundMs: 250,
	paths: Object.fromEntries(
		["complete", "timeoutFallback", "abortFallback"].map((name) => [
			name,
			{ p99Ms: 0.3, passed: true },
		]),
	),
	passed: true,
};
const rawPolicyReport = {
	files: [
		{
			groups: [
				{
					benchmarks: [
						{
							name: "normal growth decision",
							hz: 1_000,
							min: 0.001,
							max: 0.1,
							mean: 0.002,
							p75: 0.002,
							p99: 0.004,
							p995: 0.005,
							p999: 0.006,
							rme: 0.5,
							sampleCount: 500,
						},
					],
				},
			],
		},
	],
};

function evidenceArtifact() {
	const policyProfile = normalizePolicyReport(rawPolicyReport);
	return {
		schemaVersion: 1,
		metadata: {
			runner: "ubuntu-latest",
			os: "Linux 6.11",
			arch: "X64",
			node: "v24.0.0",
			vitest: "4.1.9",
			repository: "T50-Systems/pi-compaction-improvement",
			commit: "0123456789abcdef",
			workflowRunId: "123",
			workflowRunAttempt: 1,
		},
		configuration: {
			repetitions: 1,
			provider: "deterministic-fake",
			networkCalls: false,
			summarySafetyBoundMs: 250,
			finalSummarySloSelected: false,
		},
		runs: [
			{
				iteration: 1,
				SUMMARY_PROFILE: normalizeSummaryProfile(rawSummaryProfile),
				SUMMARY_MEMORY: normalizeSummaryMemory(rawMemory),
				SUMMARY_POLICY: normalizeSummaryPolicy(rawSummaryPolicy),
				POLICY_PROFILE: policyProfile,
				POLICY_RESULT: buildPolicyResult(policyProfile),
			},
		],
	};
}

describe("hosted benchmark evidence", () => {
	it("extracts exactly one tagged machine-readable record", () => {
		expect(parseTaggedJson('noise\nSUMMARY_PROFILE {"p99Ms":1}\n', "SUMMARY_PROFILE")).toEqual({
			p99Ms: 1,
		});
		expect(() =>
			parseTaggedJson(
				'SUMMARY_PROFILE {}\nSUMMARY_PROFILE {}\n',
				"SUMMARY_PROFILE",
			),
		).toThrow("expected exactly one");
	});

	it("allowlists numeric benchmark fields and drops arbitrary payloads", () => {
		const profile = normalizeSummaryProfile({ ...rawSummaryProfile, prompt: "must not persist" });
		const policy = normalizePolicyReport({
			...rawPolicyReport,
			prompt: "must not persist",
		});

		expect(profile).not.toHaveProperty("prompt");
		expect(policy[0]).not.toHaveProperty("prompt");
	});

	it("preserves the broad 250 ms summary safety bound", () => {
		expect(normalizeSummaryPolicy(rawSummaryPolicy)).toMatchObject({
			boundMs: 250,
			finalSlo: false,
			passed: true,
		});
		expect(() =>
			normalizeSummaryPolicy({ ...rawSummaryPolicy, boundMs: 100 }),
		).toThrow("bound changed from 250 ms");
	});

	it("validates the numeric evidence schema and rejects prompt fields", async () => {
		const artifact = evidenceArtifact();
		expect(await validateHostedBenchmarkArtifact(artifact)).toEqual([]);

		const unsafeArtifact = structuredClone(artifact);
		Object.assign(unsafeArtifact.runs[0].SUMMARY_PROFILE, { prompt: "must fail" });
		expect((await validateHostedBenchmarkArtifact(unsafeArtifact)).join("\n")).toContain(
			"additional properties",
		);
	});
});
