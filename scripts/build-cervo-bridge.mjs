#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeRoot = path.join(repositoryRoot, "bridge", "cervo-compress");
const outputDirectory = path.join(repositoryRoot, "bin");
const outputPath = path.join(
	outputDirectory,
	process.platform === "win32" ? "pi-cervo-compress.exe" : "pi-cervo-compress",
);

await mkdir(outputDirectory, { recursive: true });

const child = spawn("go", ["build", "-trimpath", "-o", outputPath, "."], {
	cwd: bridgeRoot,
	stdio: "inherit",
	shell: false,
});

const exitCode = await new Promise((resolve, reject) => {
	child.once("error", reject);
	child.once("exit", (code) => resolve(code ?? 1));
});
if (exitCode !== 0) process.exit(exitCode);
console.log(`built ${path.relative(repositoryRoot, outputPath)}`);
