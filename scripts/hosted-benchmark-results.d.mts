export const SUMMARY_SAFETY_BOUND_MS: 250;
export const SUMMARY_REGRESSION_BUDGET_MS: 25;
export const SUMMARY_REGRESSION_EVIDENCE_RUN_ID: "29458769458";
export const POLICY_P99_TARGET_MS: 5;

export interface PercentileRecord {
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	samples: number;
}

export interface PolicyProfileRecord {
	name: string;
	hz: number;
	min: number;
	max: number;
	mean: number;
	p75: number;
	p99: number;
	p995: number;
	p999: number;
	rme: number;
	sampleCount: number;
}

export function parseTaggedJson(output: string, tag: string): unknown;
export function normalizeSummaryProfile(value: unknown): Record<string, PercentileRecord>;
export function normalizeSummaryMemory(value: unknown): Array<Record<string, string | number>>;
export function normalizeSummaryPolicy(value: unknown): Record<string, unknown>;
export function normalizeSummaryRegressionPolicy(value: unknown): Record<string, unknown>;
export function normalizePolicyReport(value: unknown): PolicyProfileRecord[];
export function buildPolicyResult(profile: PolicyProfileRecord[]): {
	targetP99Ms: number;
	kind: string;
	paths: Array<{ name: string; p99Ms: number; passed: boolean }>;
	passed: boolean;
};
export function validateHostedBenchmarkArtifact(artifact: unknown): Promise<string[]>;
