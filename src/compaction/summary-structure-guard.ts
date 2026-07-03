const REQUIRED_HEADERS = [
	"Goal",
	"Progress",
	"Immediate Next Action",
	"Continuation Contract",
	"Critical Context",
] as const;

const PLACEHOLDER_PATTERN =
	/\[[^\]]*(?:what the user|requirements|completed work|current work|concrete blockers|decision|important unresolved|exactly one concrete|specific question|ordered follow-up|exact file paths|none if)[^\]]*\]/i;

export type SummaryStructureIssue =
	| "missing-header"
	| "empty-section"
	| "placeholder-content";

export interface SummaryStructureValidation {
	ok: boolean;
	issues: SummaryStructureIssue[];
	missingHeaders: string[];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasHeader(summary: string, header: string): boolean {
	const pattern = new RegExp(`^##\\s+${escapeRegExp(header)}\\s*$`, "im");
	return pattern.test(summary);
}

function sectionBody(summary: string, header: string): string {
	const pattern = new RegExp(
		`^##\\s+${escapeRegExp(header)}\\s*$([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`,
		"im",
	);
	return pattern.exec(summary)?.[1]?.trim() ?? "";
}

function hasMeaningfulSection(summary: string, header: string): boolean {
	const body = sectionBody(summary, header);
	if (!body) return false;
	return body
		.split(/\r?\n/)
		.map((line) => line.replace(/^[-*]\s*/, "").trim())
		.some(
			(line) => line && !line.startsWith("[") && line !== "-" && line !== "1.",
		);
}

export function validateSummaryStructure(
	summary: string,
): SummaryStructureValidation {
	const missingHeaders = REQUIRED_HEADERS.filter(
		(header) => !hasHeader(summary, header),
	);
	const issues: SummaryStructureIssue[] = [];
	if (missingHeaders.length > 0) issues.push("missing-header");
	for (const header of REQUIRED_HEADERS) {
		if (
			!missingHeaders.includes(header) &&
			!hasMeaningfulSection(summary, header)
		) {
			issues.push("empty-section");
			break;
		}
	}
	if (PLACEHOLDER_PATTERN.test(summary)) issues.push("placeholder-content");
	return {
		ok: issues.length === 0,
		issues,
		missingHeaders,
	};
}
