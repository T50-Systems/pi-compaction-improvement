import { complete } from "@earendil-works/pi-ai/compat";

export const SUMMARIZATION_SYSTEM_PROMPT =
	"You are a context summarization assistant. Read the provided conversation material and output only the requested structured summary. Do not continue the conversation.";
export const SUMMARY_TIMEOUT_MS = 120_000;

type CompleteModel = Parameters<typeof complete>[0];
type CompleteOptions = NonNullable<Parameters<typeof complete>[2]>;

export interface SummaryProviderInput {
	model: CompleteModel;
	auth: Pick<CompleteOptions, "apiKey" | "headers" | "env">;
	promptText: string;
	maxTokens: number;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export type SummaryProviderResult =
	| { ok: true; summary: string }
	| {
			ok: false;
			reason: "aborted" | "empty" | "provider-error" | "timeout";
			message?: string;
	  };

function collectSummaryText(
	response: Awaited<ReturnType<typeof complete>>,
): string {
	return response.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
}

export async function requestSummary(
	input: SummaryProviderInput,
): Promise<SummaryProviderResult> {
	const timeoutController = new AbortController();
	let timedOut = false;
	const abortTimeout = setTimeout(() => {
		timedOut = true;
		timeoutController.abort();
	}, input.timeoutMs ?? SUMMARY_TIMEOUT_MS);
	const abortFromParent = () => timeoutController.abort();
	if (input.signal?.aborted) timeoutController.abort();
	input.signal?.addEventListener("abort", abortFromParent, { once: true });

	try {
		const response = await complete(
			input.model,
			{
				systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: input.promptText }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: input.auth.apiKey,
				headers: input.auth.headers,
				env: input.auth.env,
				maxTokens: input.maxTokens,
				signal: timeoutController.signal,
			},
		);
		const summary = collectSummaryText(response);
		return summary ? { ok: true, summary } : { ok: false, reason: "empty" };
	} catch (error) {
		if (timedOut) return { ok: false, reason: "timeout" };
		if (input.signal?.aborted || timeoutController.signal.aborted) {
			return { ok: false, reason: "aborted" };
		}
		return {
			ok: false,
			reason: "provider-error",
			message: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(abortTimeout);
		input.signal?.removeEventListener("abort", abortFromParent);
	}
}
