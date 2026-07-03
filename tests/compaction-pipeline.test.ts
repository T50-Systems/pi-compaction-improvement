import { describe, expect, it } from "vitest";
import { runCompactionPipeline } from "../src/compaction/pipeline.ts";

describe("compaction pipe-and-filter runner", () => {
	it("runs filters in order and passes context forward", async () => {
		const result = await runCompactionPipeline(
			{ values: [] as string[] },
			[
				(context) => ({ values: [...context.values, "observe"] }),
				async (context) => ({ values: [...context.values, "produce"] }),
				(context) => ({ values: [...context.values, "verify"] }),
			],
		);

		expect(result.values).toEqual(["observe", "produce", "verify"]);
	});
});
