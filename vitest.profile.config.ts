import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["benchmarks/summary-profile.ts"],
		testTimeout: 30_000,
		disableConsoleIntercept: true,
	},
});
