type TextLikeBlock = { text?: string; type?: string };

type ToolResultLike = {
  content?: unknown;
  details?: unknown;
};

function estimateUnknownChars(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateUnknownChars(item), 0);
  if (!value || typeof value !== "object") return 0;

  const maybeTextBlock = value as TextLikeBlock;
  if (typeof maybeTextBlock.text === "string") return maybeTextBlock.text.length;

  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export function estimateToolResultTokens(toolResults: ToolResultLike[]): number {
  const chars = toolResults.reduce(
    (sum, result) => sum + estimateUnknownChars(result.content) + estimateUnknownChars(result.details),
    0,
  );
  return Math.ceil(chars / 4);
}
