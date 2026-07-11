import { bench, describe } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { decideAutoCompact } from "../src/policy.ts";

const base = {
	config: DEFAULT_CONFIG,
	currentTokens: 100_000,
	previousTokens: 90_000,
	contextWindow: 200_000,
	turnIndex: 25,
	consecutiveGrowthTurns: 2,
	compactInFlight: false,
	lastTriggerTurn: 10,
	toolResultTokens: 8_000,
	toolResultsCount: 10,
};

describe("autocompaction policy", () => {
	bench("normal growth decision", () => {
		decideAutoCompact(base);
	});

	bench("emergency decision", () => {
		decideAutoCompact({ ...base, currentTokens: 190_000 });
	});
});
