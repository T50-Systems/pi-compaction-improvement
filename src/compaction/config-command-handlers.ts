import {
	coerceRawConfigValue,
	DEFAULT_CONFIG,
	formatConfigEditorText,
	loadScopeConfig,
	parseConfigEditorText,
	resetScopeConfig,
	type ConfigScope,
	writeScopeConfig,
} from "../config.ts";
import type { AutoCompactState } from "../state.ts";
import type { CommandContextPort } from "./ports.ts";
import { showStatus } from "./status-command-handlers.ts";
import { notify } from "./telemetry.ts";

export async function setGlobalEnabled(
	ctx: CommandContextPort,
	state: AutoCompactState,
	enabled: boolean,
): Promise<void> {
	const current = await loadScopeConfig("global", ctx.cwd);
	const next = { ...current.raw, enabled };
	const filePath = await writeScopeConfig("global", ctx.cwd, next);
	notify(
		ctx,
		`Autocompact v2 ${enabled ? "enabled" : "disabled"} via ${filePath}`,
		"info",
	);
	await showStatus(ctx, state);
}

export async function handleConfigCommand(
	args: string,
	ctx: CommandContextPort,
	state: AutoCompactState,
): Promise<void> {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	let scope: ConfigScope = "global";
	if (parts[0] === "global" || parts[0] === "project") {
		scope = parts.shift() as ConfigScope;
	}

	const action = parts[0];
	if (!action) {
		await editConfig(scope, ctx);
		await showStatus(ctx, state);
		return;
	}

	if (action === "reset") {
		const filePath = await resetScopeConfig(scope, ctx.cwd);
		notify(ctx, `Autocompact v2 ${scope} config reset at ${filePath}`, "info");
		await showStatus(ctx, state);
		return;
	}

	if (action === "path") {
		const scopeInfo = await loadScopeConfig(scope, ctx.cwd);
		notify(
			ctx,
			`Autocompact v2 ${scope} config path: ${scopeInfo.path}`,
			"info",
		);
		return;
	}

	if (parts.length >= 2) {
		await setScopeConfigValue(ctx, scope, action, parts.slice(1).join(" "));
		await showStatus(ctx, state);
		return;
	}

	notify(
		ctx,
		"Usage: /autocompact-config [global|project] [reset|path|<key> <value>]",
		"warning",
	);
}

async function editConfig(
	scope: ConfigScope,
	ctx: CommandContextPort,
): Promise<void> {
	const current = await loadScopeConfig(scope, ctx.cwd);
	const prefill = formatConfigEditorText(
		current.exists ? current.raw : DEFAULT_CONFIG,
	);
	const edited = await ctx.ui.editor(
		`Edit ${scope} autocompact config`,
		prefill,
	);
	if (edited === undefined) return;

	try {
		const parsed = parseConfigEditorText(edited);
		const filePath = await writeScopeConfig(scope, ctx.cwd, parsed);
		notify(ctx, `Autocompact v2 ${scope} config saved to ${filePath}`, "info");
	} catch (error) {
		notify(
			ctx,
			`Autocompact v2 config not saved: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	}
}

async function setScopeConfigValue(
	ctx: CommandContextPort,
	scope: ConfigScope,
	key: string,
	rawValue: string,
): Promise<void> {
	const current = await loadScopeConfig(scope, ctx.cwd);
	if (!(key in DEFAULT_CONFIG)) {
		notify(ctx, `Unknown autocompact setting: ${key}`, "error");
		return;
	}

	const coerced = coerceRawConfigValue(
		key as keyof typeof DEFAULT_CONFIG,
		rawValue,
	);
	if (coerced === undefined) {
		notify(ctx, `Invalid value for ${key}: ${rawValue}`, "error");
		return;
	}

	const next = { ...current.raw, [key]: coerced };
	const filePath = await writeScopeConfig(scope, ctx.cwd, next);
	notify(ctx, `Autocompact v2 updated ${key} in ${filePath}`, "info");
}
