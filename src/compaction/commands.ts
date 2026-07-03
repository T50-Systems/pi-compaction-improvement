import type { AutoCompactState } from "../state.ts";
import {
	handleConfigCommand,
	setGlobalEnabled,
} from "./config-command-handlers.ts";
import { handleManualCompactCommand } from "./manual-compact-command.ts";
import type { CommandRegistryPort } from "./ports.ts";
import { handleStatusCommand } from "./status-command-handlers.ts";

export function registerCommands(
	pi: CommandRegistryPort,
	state: AutoCompactState,
): void {
	pi.registerCommand("autocompact-status", {
		description: "Show autocompact v2 status in a widget",
		handler: async (args, ctx) => handleStatusCommand(args, ctx, state),
	});

	pi.registerCommand("autocompact-on", {
		description: "Enable proactive autocompact globally",
		handler: async (_args, ctx) => setGlobalEnabled(ctx, state, true),
	});

	pi.registerCommand("autocompact-off", {
		description: "Disable proactive autocompact globally",
		handler: async (_args, ctx) => setGlobalEnabled(ctx, state, false),
	});

	pi.registerCommand("autocompact-now", {
		description:
			"Trigger compaction immediately with optional extra instructions",
		handler: async (args, ctx) => handleManualCompactCommand(args, ctx, state),
	});

	pi.registerCommand("autocompact-config", {
		description: "Edit, reset, or tweak autocompact v2 config",
		handler: async (args, ctx) => handleConfigCommand(args, ctx, state),
	});
}
