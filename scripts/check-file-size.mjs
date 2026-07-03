#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const maxLines = Number(process.env.PI_MAX_TS_LINES ?? "500");

const { stdout } = await execFileAsync(
	"git",
	["ls-files", "--cached", "--others", "--exclude-standard"],
	{ cwd, maxBuffer: 2_000_000 },
);
const files = [
	...new Set(
		stdout
			.split(/\r?\n/)
			.filter(Boolean)
			.filter((file) => file.endsWith(".ts"))
			.filter((file) => !file.includes("/node_modules/")),
	),
].sort();

const failures = [];
for (const file of files) {
	const content = await readFile(path.join(cwd, file), "utf8");
	const lines = content ? content.split(/\r?\n/).length : 0;
	if (lines > maxLines) failures.push({ file, lines });
}

if (failures.length === 0) {
	console.log(
		`check:file-size ok (${files.length} TypeScript files <= ${maxLines} lines)`,
	);
	process.exit(0);
}

for (const failure of failures) {
	console.error(`${failure.file}: ${failure.lines} lines exceeds ${maxLines}`);
}
process.exit(1);
