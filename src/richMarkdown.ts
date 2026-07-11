// Rich Markdown special characters that must be escaped in untrusted content,
// see https://core.telegram.org/bots/api#rich-markdown-style
export const escapeRichMarkdown = (str?: string | null): string => (str ?? "").replace(/([\\`*_~=|[\]#$^>])/g, "\\$1");

export function highlightCode(escapedText: string, rawCode: string | null): string {
    if (!rawCode) return escapedText;
    const escapedCode = escapeRichMarkdown(rawCode);
    const pattern = escapedCode.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return escapedText.replace(new RegExp(`\\b${pattern}\\b`, "g"), `\`${rawCode}\``);
}
