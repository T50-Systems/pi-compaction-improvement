import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { LineCounter, parseDocument } from "yaml";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaFiles = {
	dependabot: path.join(
		scriptDirectory,
		"schemas",
		"dependabot-2.0.schema.json",
	),
	workflow: path.join(
		scriptDirectory,
		"schemas",
		"github-workflow.schema.json",
	),
};

let validatorsPromise;

function hardenDependabotSchema(schema) {
	const scheduleSchemas = [
		schema.definitions?.update?.properties?.schedule,
		schema.definitions?.["multi-ecosystem-group"]?.properties?.schedule,
	];
	for (const schedule of scheduleSchemas) {
		if (schedule) schedule.additionalProperties = false;
	}
	return schema;
}

async function loadValidators() {
	if (!validatorsPromise) {
		validatorsPromise = (async () => {
			const [dependabotSchema, workflowSchema] = await Promise.all(
				Object.values(schemaFiles).map(async (file) =>
					JSON.parse(await readFile(file, "utf8")),
				),
			);
			const ajv = new Ajv({
				allErrors: true,
				allowUnionTypes: true,
				strict: false,
				validateFormats: false,
			});
			return {
				dependabot: ajv.compile(hardenDependabotSchema(dependabotSchema)),
				workflow: ajv.compile(workflowSchema),
			};
		})();
	}
	return validatorsPromise;
}

function decodePointer(pointer) {
	if (!pointer) return [];
	return pointer
		.slice(1)
		.split("/")
		.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
		.map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part));
}

function schemaErrorPath(error) {
	const parts = decodePointer(error.instancePath);
	if (error.keyword === "additionalProperties") {
		parts.push(error.params.additionalProperty);
	}
	return parts;
}

function locateSchemaError(document, lineCounter, error) {
	const parts = schemaErrorPath(error);
	let node = document.getIn(parts, true);
	if (!node && parts.length > 0) node = document.getIn(parts.slice(0, -1), true);
	const offset = node?.range?.[0] ?? 0;
	return { parts, ...lineCounter.linePos(offset) };
}

function formatPath(parts) {
	if (parts.length === 0) return "$";
	return parts.reduce(
		(result, part) =>
			typeof part === "number" ? `${result}[${part}]` : `${result}.${part}`,
		"$",
	);
}

export async function validateYamlFile(file, kind) {
	const source = await readFile(file, "utf8");
	const lineCounter = new LineCounter();
	const document = parseDocument(source, {
		lineCounter,
		prettyErrors: true,
		uniqueKeys: true,
	});
	const relativeFile = path.relative(process.cwd(), file).replaceAll("\\", "/");

	const parserIssues = [...document.errors, ...document.warnings];
	if (parserIssues.length > 0) {
		return parserIssues.map((error) => {
			const location = error.linePos?.[0] ?? { line: 1, col: 1 };
			return `${relativeFile}:${location.line}:${location.col} ${error.message}`;
		});
	}

	const validators = await loadValidators();
	const validate = validators[kind];
	const valid = validate(document.toJS({ mapAsMap: false }));
	if (valid) return [];

	return (validate.errors ?? []).map((error) => {
		const location = locateSchemaError(document, lineCounter, error);
		return `${relativeFile}:${location.line}:${location.col} ${formatPath(location.parts)} ${error.message}`;
	});
}

export async function discoverGithubConfigFiles(root) {
	const workflowDirectory = path.join(root, ".github", "workflows");
	const workflowEntries = await readdir(workflowDirectory, { withFileTypes: true });
	const files = workflowEntries
		.filter(
			(entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name),
		)
		.map((entry) => ({
			file: path.join(workflowDirectory, entry.name),
			kind: "workflow",
		}));
	files.push({
		file: path.join(root, ".github", "dependabot.yml"),
		kind: "dependabot",
	});
	return files.sort((left, right) => left.file.localeCompare(right.file));
}

export async function validateGithubConfig(root = process.cwd()) {
	const files = await discoverGithubConfigFiles(root);
	const results = await Promise.all(
		files.map(async ({ file, kind }) => ({
			errors: await validateYamlFile(file, kind),
			file,
			kind,
		})),
	);
	return {
		errors: results.flatMap((result) => result.errors),
		files: results.map((result) => result.file),
	};
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	try {
		const result = await validateGithubConfig();
		if (result.errors.length > 0) {
			for (const error of result.errors) console.error(error);
			process.exitCode = 1;
		} else {
			console.log(
				`GitHub config schema validation passed (${result.files.length} files).`,
			);
		}
	} catch (error) {
		console.error(
			`GitHub config validation failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
