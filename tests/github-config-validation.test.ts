import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	validateGithubConfig,
	validateYamlFile,
} from "../scripts/validate-github-config.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(import.meta.dirname, "fixtures", "github-config");

describe("GitHub configuration schema validation", () => {
	it("accepts every checked-in workflow and Dependabot configuration", async () => {
		const result = await validateGithubConfig(repositoryRoot);

		expect(result.files.map((file) => path.basename(file))).toEqual([
			"dependabot.yml",
			"ci.yml",
			"release.yml",
		]);
		expect(result.errors).toEqual([]);
	});

	it("reports a useful file and line for an invalid workflow key", async () => {
		const file = path.join(fixtures, "invalid-workflow.yml");
		const errors = await validateYamlFile(file, "workflow");

		const output = errors.join("\n");
		expect(output).toContain("invalid-workflow.yml:6:");
		expect(output).toContain(
			"$.jobs.validate.runs-onn must NOT have additional properties",
		);
	});

	it("rejects an unknown Dependabot schedule key", async () => {
		const file = path.join(fixtures, "invalid-dependabot.yml");
		const errors = await validateYamlFile(file, "dependabot");

		const output = errors.join("\n");
		expect(output).toContain("invalid-dependabot.yml:7:");
		expect(output).toContain(
			"$.updates[0].schedule.intervals must NOT have additional properties",
		);
	});

	it("treats YAML parser warnings as validation failures", async () => {
		const file = path.join(fixtures, "warning-workflow.yml");
		const errors = await validateYamlFile(file, "workflow");

		expect(errors.join("\n")).toContain(
			"warning-workflow.yml:1:7 Unresolved tag",
		);
	});
});
