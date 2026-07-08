const TODO_BLOCK_MIN_ROWS = 8;
const TODO_KEEP_MAX_ACTIONABLE_ROWS = 12;
const COUNT_PATH_RUN_MIN_ROWS = 12;
const COUNT_PATH_KEEP_HEAD_ROWS = 5;
const COUNT_PATH_KEEP_TAIL_ROWS = 2;
const COMPLETED_CHECKLIST_RUN_MIN_ROWS = 8;
const COMPLETED_CHECKLIST_KEEP_ROWS = 3;

const TODO_HEADER_PATTERN = /^\s*(?:\[[^\]]+\]:\s*)?(?:[●*+-]\s*)?Todos?\s*\((\d+)\s*\/\s*(\d+)\)/i;
const TODO_ROW_PATTERN = /^\s*(?:[│├└─\s]+)?(?:[✓✔✗□☐⟳…-]|\[[ xX-]\]|#\d+|\d+[.)])/;
const COMPLETED_TODO_ROW_PATTERN = /^\s*(?:[│├└─\s]+)?(?:✓|✔|\[x\])/i;
const COUNT_PATH_LINE_PATTERN = /^\s*\d+\s+[A-Za-z0-9_./\\-]+(?:\s+[A-Za-z0-9_./\\-]+)*\s*$/;
const COMPLETED_CHECKLIST_LINE_PATTERN = /^\s*[-*]\s+\[x\]\s+/i;

function plural(value: number, singular: string, pluralValue = `${singular}s`): string {
	return value === 1 ? singular : pluralValue;
}

function isTodoHeader(line: string): boolean {
	return TODO_HEADER_PATTERN.test(line);
}

function isTodoRow(line: string): boolean {
	return TODO_ROW_PATTERN.test(line);
}

function isCompletedTodoRow(line: string): boolean {
	return COMPLETED_TODO_ROW_PATTERN.test(line);
}

function condenseTodoRows(header: string, rows: string[]): string[] {
	if (rows.length < TODO_BLOCK_MIN_ROWS) return [header, ...rows];

	const completedRows = rows.filter(isCompletedTodoRow).length;
	const actionableRows = rows.filter((line) => !isCompletedTodoRow(line));
	const keptActionableRows = actionableRows.slice(0, TODO_KEEP_MAX_ACTIONABLE_ROWS);
	const omittedActionableRows = Math.max(
		0,
		actionableRows.length - keptActionableRows.length,
	);

	return [
		header,
		`[compaction note: condensed ${rows.length}-row todo snapshot; omitted ${completedRows} completed ${plural(completedRows, "row")}. Keep only active/pending/blocker items below.]`,
		...(keptActionableRows.length > 0
			? keptActionableRows
			: ["- No active, pending, or blocker todo rows were visible in this snapshot."]),
		...(omittedActionableRows > 0
			? [
					`[compaction note: omitted ${omittedActionableRows} additional active/pending/blocker ${plural(omittedActionableRows, "row")}.]`,
				]
			: []),
	];
}

function condenseTodoSnapshots(text: string): string {
	const lines = text.split("\n");
	const output: string[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!isTodoHeader(line)) {
			output.push(line);
			continue;
		}

		const rows: string[] = [];
		let cursor = index + 1;
		while (cursor < lines.length && isTodoRow(lines[cursor])) {
			rows.push(lines[cursor]);
			cursor += 1;
		}

		output.push(...condenseTodoRows(line, rows));
		index = cursor - 1;
	}

	return output.join("\n");
}

function condenseLineRuns(input: {
	text: string;
	isRunLine: (line: string) => boolean;
	minRows: number;
	keepHeadRows: number;
	keepTailRows: number;
	note: (omittedRows: number) => string;
}): string {
	const lines = input.text.split("\n");
	const output: string[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		if (!input.isRunLine(lines[index])) {
			output.push(lines[index]);
			continue;
		}

		const run: string[] = [];
		let cursor = index;
		while (cursor < lines.length && input.isRunLine(lines[cursor])) {
			run.push(lines[cursor]);
			cursor += 1;
		}

		if (run.length < input.minRows) {
			output.push(...run);
		} else {
			const omittedRows = Math.max(
				0,
				run.length - input.keepHeadRows - input.keepTailRows,
			);
			const tailRows =
				input.keepTailRows > 0 ? run.slice(-input.keepTailRows) : [];
			output.push(
				...run.slice(0, input.keepHeadRows),
				input.note(omittedRows),
				...tailRows,
			);
		}

		index = cursor - 1;
	}

	return output.join("\n");
}

function condenseCountPathRuns(text: string): string {
	return condenseLineRuns({
		text,
		isRunLine: (line) => COUNT_PATH_LINE_PATTERN.test(line),
		minRows: COUNT_PATH_RUN_MIN_ROWS,
		keepHeadRows: COUNT_PATH_KEEP_HEAD_ROWS,
		keepTailRows: COUNT_PATH_KEEP_TAIL_ROWS,
		note: (omittedRows) =>
			`[compaction note: omitted ${omittedRows} count/path output ${plural(omittedRows, "line")}; keep command conclusion instead of reprinting the full listing.]`,
	});
}

function condenseCompletedChecklistRuns(text: string): string {
	return condenseLineRuns({
		text,
		isRunLine: (line) => COMPLETED_CHECKLIST_LINE_PATTERN.test(line),
		minRows: COMPLETED_CHECKLIST_RUN_MIN_ROWS,
		keepHeadRows: COMPLETED_CHECKLIST_KEEP_ROWS,
		keepTailRows: 0,
		note: (omittedRows) =>
			`[compaction note: omitted ${omittedRows} completed checklist ${plural(omittedRows, "row")}; summarize completed work by category/count instead of listing every item.]`,
	});
}

export function condenseSerializedConversationNoise(text: string): string {
	return condenseCompletedChecklistRuns(
		condenseCountPathRuns(condenseTodoSnapshots(text)),
	);
}
