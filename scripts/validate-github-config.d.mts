export type GithubConfigKind = "dependabot" | "workflow";

export function validateYamlFile(
	file: string,
	kind: GithubConfigKind,
): Promise<string[]>;

export function discoverGithubConfigFiles(
	root: string,
): Promise<Array<{ file: string; kind: GithubConfigKind }>>;

export function validateGithubConfig(
	root?: string,
): Promise<{ errors: string[]; files: string[] }>;
