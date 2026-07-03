export type SummarySizeIssue = "too-long";

export interface SummarySizeValidation {
	ok: boolean;
	issues: SummarySizeIssue[];
	estimatedTokens: number;
	maxAllowedTokens: number;
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function validateSummarySize(input: {
	summary: string;
	tokensBefore: number;
	maxTokens: number;
}): SummarySizeValidation {
	const estimatedTokens = estimateTokens(input.summary);
	const compressionBudget = Math.max(512, Math.floor(input.tokensBefore * 0.6));
	const maxAllowedTokens = Math.max(
		128,
		Math.min(input.maxTokens, compressionBudget),
	);
	const ok = estimatedTokens <= maxAllowedTokens;
	return {
		ok,
		issues: ok ? [] : ["too-long"],
		estimatedTokens,
		maxAllowedTokens,
	};
}
