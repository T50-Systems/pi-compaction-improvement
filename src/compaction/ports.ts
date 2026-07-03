import type { ConfigLoadResult } from "../config.ts";
import type { NotifyType } from "./types.ts";

export interface CompactPort {
	compact(options: {
		customInstructions?: string;
		onComplete?: () => void;
		onError?: (error: Error) => void;
	}): void;
}

export interface SessionActivityPort {
	isIdle(): boolean;
	hasPendingMessages(): boolean;
	signal?: AbortSignal | undefined;
}

export interface NotifyPort {
	notify(message: string, type?: NotifyType): void;
}

export interface NotifyContextPort {
	hasUI?: boolean;
	ui: {
		notify(message: string, type?: NotifyType): void;
	};
}

export interface SchedulerContextPort
	extends CompactPort,
		SessionActivityPort,
		NotifyContextPort {}

export interface ClockPort {
	setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
	clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export const systemClock: ClockPort = {
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	clearTimeout: (handle) => clearTimeout(handle),
};

export interface UsageSnapshot {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface StatusContextPort {
	cwd: string;
	isProjectTrusted(): boolean;
	getContextUsage(): UsageSnapshot | undefined;
	ui: {
		setStatus(key: string, value: string | undefined): void;
		setWidget(
			key: string,
			value: string[] | undefined,
			options?: unknown,
		): void;
	};
}

export interface CommandContextPort
	extends StatusContextPort,
		NotifyContextPort,
		CompactPort {
	ui: StatusContextPort["ui"] &
		NotifyContextPort["ui"] & {
			editor(title: string, prefill: string): Promise<string | undefined>;
		};
}

export interface CommandRegistryPort {
	registerCommand(
		name: string,
		command: {
			description: string;
			handler(args: string, ctx: CommandContextPort): Promise<void>;
		},
	): void;
}

export interface ConfigContextPort {
	cwd: string;
	isProjectTrusted(): boolean;
}

export type EffectiveConfigLoader = (
	cwd: string,
	trusted: boolean,
) => Promise<ConfigLoadResult>;
