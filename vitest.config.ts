import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			thresholds: {
				lines: 85,
				statements: 85,
				functions: 85,
				branches: 70,
				"src/compaction/config-command-handlers.ts": {
					lines: 90,
					functions: 90,
					branches: 75,
				},
				"src/compaction/manual-compact-command.ts": {
					lines: 90,
					functions: 90,
					branches: 75,
				},
				"src/compaction/status-command-handlers.ts": {
					lines: 90,
					functions: 90,
					branches: 75,
				},
			},
		},
	},
});
