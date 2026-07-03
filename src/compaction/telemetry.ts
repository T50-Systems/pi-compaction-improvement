import type { NotifyContextPort } from "./ports.ts";
import type { NotifyType } from "./types.ts";

export function notify(
	ctx: NotifyContextPort,
	message: string,
	type: NotifyType = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}

export function debugNotify(
	ctx: NotifyContextPort,
	enabled: boolean,
	message: string,
): void {
	if (enabled) notify(ctx, `Autocompact v2: ${message}`, "info");
}
