const REQUIRED_HEADERS = [
	"Goal",
	"Constraints & Preferences",
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
	| "missing-blocked-subsection"
	| "invalid-next-action"
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

function hasProgressBlockers(summary: string): boolean {
	const progress = sectionBody(summary, "Progress");
	const blocked = /^###\s+Blocked\s*$([\s\S]*?)(?=^###\s+|$(?![\s\S]))/im.exec(
		progress,
	)?.[1];
	return Boolean(blocked?.trim());
}

function hasExactlyOneImmediateAction(summary: string): boolean {
	const body = sectionBody(summary, "Immediate Next Action");
	return (
		body.split(/\r?\n/).filter((line) => /^\s*\d+\.\s+\S/.test(line))
			.length === 1
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
	if (!missingHeaders.includes("Progress") && !hasProgressBlockers(summary)) {
		issues.push("missing-blocked-subsection");
	}
	if (
		!missingHeaders.includes("Immediate Next Action") &&
		!hasExactlyOneImmediateAction(summary)
	) {
		issues.push("invalid-next-action");
	}
	if (PLACEHOLDER_PATTERN.test(summary)) issues.push("placeholder-content");
	return {
		ok: issues.length === 0,
		issues,
		missingHeaders,
	};
}
