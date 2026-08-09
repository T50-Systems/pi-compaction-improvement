import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./event-guard.ts";
import type { SafeCompactionPreparation } from "./types.ts";

export const CERVO_PREPROCESS_PROTOCOL_VERSION = 1;
export const DEFAULT_CERVO_TOOL_RESULT_LIMIT_BYTES = 4_096;
const MAX_BRIDGE_BYTES = 32 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 10_000;
const ENGINE_NAMES = new Set([
	"toolnoise",
	"dedup",
	"command-class",
	"toolresult-cap",
	"json-table",
]);

interface BridgeRequest {
	version: 1;
	messages: unknown[];
	toolResultLimit: number;
}

interface BridgeReport {
	originalBytes: number;
	savedBytes: number;
	engines: string[];
	byEngine: Array<{ Name: string; SavedBytes: number }>;
}

interface BridgeResponse {
	version: 1;
	messages: unknown[];
	report: BridgeReport;
}

export type CervoPreprocessFailureReason =
	| "bridge-unavailable"
	| "bridge-failed"
	| "invalid-output";

export type CervoPreprocessResult =
	| {
			ok: true;
			preparation: SafeCompactionPreparation;
			changed: boolean;
			report: BridgeReport;
	  }
	| { ok: false; reason: CervoPreprocessFailureReason };

export type CervoBridgeRunner = (request: BridgeRequest) => Promise<unknown>;

export async function preprocessWithCervoCompress(
	preparation: SafeCompactionPreparation,
	options: {
		runBridge?: CervoBridgeRunner;
		toolResultLimit?: number;
	} = {},
): Promise<CervoPreprocessResult> {
	const history = convertToLlm(preparation.messagesToSummarize as never) as unknown[];
	const turnPrefix = convertToLlm(preparation.turnPrefixMessages as never) as unknown[];
	const converted = [...history, ...turnPrefix];
	const messages = converted.map(toCervoDialect);
	const request: BridgeRequest = {
		version: CERVO_PREPROCESS_PROTOCOL_VERSION,
		messages,
		toolResultLimit:
			options.toolResultLimit ?? DEFAULT_CERVO_TOOL_RESULT_LIMIT_BYTES,
	};

	let raw: unknown;
	try {
		raw = await (options.runBridge ?? runPackagedBridge)(request);
	} catch (error) {
		return {
			ok: false,
			reason: isUnavailableError(error)
				? "bridge-unavailable"
				: "bridge-failed",
		};
	}
	const response = validateBridgeResponse(raw, messages);
	if (!response) return { ok: false, reason: "invalid-output" };

	const restored = response.messages.map((message, index) =>
		restorePiRole(message, converted[index]),
	);
	const splitAt = history.length;
	return {
		ok: true,
		preparation: {
			...preparation,
			messagesToSummarize: restored.slice(0, splitAt),
			turnPrefixMessages: restored.slice(splitAt),
			messagesAreLlm: true,
		},
		changed: response.report.savedBytes > 0,
		report: response.report,
	};
}

async function runPackagedBridge(request: BridgeRequest): Promise<unknown> {
	const executable = await resolveBridgeExecutable();
	if (!executable) throw unavailableError();
	const input = JSON.stringify(request);
	if (Buffer.byteLength(input, "utf8") > MAX_BRIDGE_BYTES) {
		throw new Error("bridge input exceeds the local safety limit");
	}
	return runProcess(executable, input);
}

async function resolveBridgeExecutable(): Promise<string | undefined> {
	const configured = process.env.PI_CERVO_COMPRESS_BIN?.trim();
	const candidates = configured
		? [path.resolve(configured)]
		: [
				fileURLToPath(
					new URL(
						process.platform === "win32"
							? "../../bin/pi-cervo-compress.exe"
							: "../../bin/pi-cervo-compress",
						import.meta.url,
					),
				),
			];
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Missing bridge is classified without exposing a machine-specific path.
		}
	}
	return undefined;
}

function runProcess(executable: string, input: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, [], { shell: false, windowsHide: true });
		const stdout: Buffer[] = [];
		let stdoutBytes = 0;
		let settled = false;
		const timeout = setTimeout(() => finish(new Error("bridge timeout")), BRIDGE_TIMEOUT_MS);

		const finish = (error?: Error, value?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (error) {
				child.kill();
				reject(error);
			} else {
				resolve(value);
			}
		};
		child.once("error", (error) => finish(error));
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > MAX_BRIDGE_BYTES) {
				finish(new Error("bridge output exceeds the local safety limit"));
				return;
			}
			stdout.push(chunk);
		});
		child.once("close", (code) => {
			if (code !== 0) return finish(new Error("bridge exited unsuccessfully"));
			try {
				finish(undefined, JSON.parse(Buffer.concat(stdout).toString("utf8")));
			} catch {
				finish(new Error("bridge returned invalid JSON"));
			}
		});
		child.stdin.once("error", (error) => finish(error));
		child.stdin.end(input);
	});
}

function validateBridgeResponse(
	value: unknown,
	original: unknown[],
): BridgeResponse | undefined {
	if (!isRecord(value) || value.version !== CERVO_PREPROCESS_PROTOCOL_VERSION) {
		return undefined;
	}
	if (!Array.isArray(value.messages) || value.messages.length !== original.length) {
		return undefined;
	}
	const messages = value.messages as unknown[];
	if (!isRecord(value.report)) return undefined;
	const report = value.report;
	if (
		!isNonNegativeInteger(report.originalBytes) ||
		!isNonNegativeInteger(report.savedBytes) ||
		!Array.isArray(report.engines) ||
		!report.engines.every((name) => typeof name === "string" && ENGINE_NAMES.has(name)) ||
		!Array.isArray(report.byEngine)
	) {
		return undefined;
	}
	const engines = report.engines as string[];
	const byEngine = report.byEngine as unknown[];
	if (
		byEngine.length !== engines.length ||
		!byEngine.every(
			(item, index) =>
				isRecord(item) &&
				typeof item.Name === "string" &&
				ENGINE_NAMES.has(item.Name) &&
				item.Name === engines[index] &&
				isPositiveInteger(item.SavedBytes),
		)
	) {
		return undefined;
	}
	if (new Set(engines).size !== engines.length) return undefined;
	if (
		!original.every((message, index) =>
			isDeepStrictEqual(
				maskMutableContent(message),
				maskMutableContent(messages[index]),
			),
		)
	) {
		return undefined;
	}
	const originalBytes = measureCervoText(original);
	const outputBytes = measureCervoText(messages);
	const engineTotal = byEngine.reduce(
		(total: number, item) => total + (item as { SavedBytes: number }).SavedBytes,
		0,
	);
	if (
		report.originalBytes !== originalBytes ||
		report.savedBytes !== originalBytes - outputBytes ||
		report.savedBytes !== engineTotal
	) {
		return undefined;
	}
	if (report.savedBytes === 0 && !isDeepStrictEqual(original, messages)) {
		return undefined;
	}
	return value as unknown as BridgeResponse;
}

function toCervoDialect(value: unknown): unknown {
	if (!isRecord(value) || value.role !== "toolResult") return value;
	return { ...value, role: "tool" };
}

function restorePiRole(value: unknown, original: unknown): unknown {
	if (!isRecord(value) || !isRecord(original)) return value;
	return original.role === "toolResult" ? { ...value, role: "toolResult" } : value;
}

function maskMutableContent(value: unknown): unknown {
	if (!isRecord(value) || typeof value.role !== "string") return value;
	const message = { ...value };
	if (typeof message.content === "string") {
		message.content = "<mutable-text>";
		return message;
	}
	if (!Array.isArray(message.content)) return message;
	message.content = message.content.map((raw) => {
		if (!isRecord(raw)) return raw;
		const block = { ...raw };
		if (message.role === "tool" && block.type === "text" && typeof block.text === "string") {
			block.text = "<mutable-text>";
		}
		if (message.role === "user" && block.type === "tool_result") {
			if (typeof block.content === "string") block.content = "<mutable-text>";
			else if (Array.isArray(block.content)) {
				block.content = block.content.map((inner) =>
					isRecord(inner) && inner.type === "text" && typeof inner.text === "string"
						? { ...inner, text: "<mutable-text>" }
						: inner,
				);
			}
		}
		return block;
	});
	return message;
}

function measureCervoText(messages: unknown[]): number {
	let bytes = 0;
	for (const raw of messages) {
		if (!isRecord(raw) || typeof raw.role !== "string") continue;
		if (typeof raw.content === "string") {
			bytes += Buffer.byteLength(raw.content, "utf8");
			continue;
		}
		if (!Array.isArray(raw.content)) continue;
		for (const item of raw.content) {
			if (!isRecord(item)) continue;
			if (raw.role === "tool" && item.type === "text" && typeof item.text === "string") {
				bytes += Buffer.byteLength(item.text, "utf8");
			}
			if (raw.role !== "user" || item.type !== "tool_result") continue;
			if (typeof item.content === "string") {
				bytes += Buffer.byteLength(item.content, "utf8");
			} else if (Array.isArray(item.content)) {
				for (const inner of item.content) {
					if (isRecord(inner) && inner.type === "text" && typeof inner.text === "string") {
						bytes += Buffer.byteLength(inner.text, "utf8");
					}
				}
			}
		}
	}
	return bytes;
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function unavailableError(): Error & { code: "ENOENT" } {
	return Object.assign(new Error("cervo-compress bridge is unavailable"), {
		code: "ENOENT" as const,
	});
}

function isUnavailableError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}
