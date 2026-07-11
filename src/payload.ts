import { escapeRichMarkdown, highlightCode } from "./richMarkdown.ts";

function pickStatusEmoji(subject: string, hasCode: boolean): string {
    const lowerSubject = subject.toLowerCase();
    if (/alert|warning|critical/.test(lowerSubject)) return "⚠️";
    if (/invoice|receipt|payment/.test(lowerSubject)) return "🧾";
    return hasCode ? "🔐" : "📧";
}

export interface RichMarkdownInput {
    subject: string;
    fromFormatted: string;
    toFormatted: string;
    dateStr: string;
    attachmentsBlock: string;
    verificationCode: string | null;
    displayBody: string;
}

// Telegram's Rich Markdown text is capped at 32,768 UTF-8 characters
// (https://core.telegram.org/bots/api#rich-message-limits). A long
// newsletter/thread could otherwise exceed that and fail to send entirely.
export const RICH_MESSAGE_MAX_LENGTH = 32768;
const TRUNCATION_NOTICE = "\n\n… (truncated — original email was too long for Telegram)";

// Only the email content block can grow unboundedly, so truncate just that
// rather than naively slicing the whole assembled markdown — a blind slice
// could cut through the header table or the closing </details> tag and
// corrupt the message structure.
export function truncateEmailContentBlock(emailContentBlock: string, fixedOverheadLength: number): string {
    const budget = RICH_MESSAGE_MAX_LENGTH - fixedOverheadLength - TRUNCATION_NOTICE.length;
    if (emailContentBlock.length <= budget) return emailContentBlock;
    if (budget <= 0) return TRUNCATION_NOTICE.trim();
    return emailContentBlock.slice(0, budget) + TRUNCATION_NOTICE;
}

export function buildRichMarkdownPayload({
    subject,
    fromFormatted,
    toFormatted,
    dateStr,
    attachmentsBlock,
    verificationCode,
    displayBody
}: RichMarkdownInput): string {
    const statusEmoji = pickStatusEmoji(subject, Boolean(verificationCode));
    const otpHeaderBlock = verificationCode ? `\n🔑 **Verification Code:** \`${verificationCode}\` \n` : "\n";

    const processedBody = highlightCode(displayBody, verificationCode);
    const fullEmailContentBlock = processedBody
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");

    const assemble = (emailContentBlock: string): string =>
        `
### ${statusEmoji} Email: ${escapeRichMarkdown(subject)}

| Field | Information |
| :--- | :--- |
| **From** | ${fromFormatted} |
| **To** | ${toFormatted} |
| **Date** | ${dateStr} |
${otpHeaderBlock}${attachmentsBlock}
<details>
<summary> Email Content</summary>

${emailContentBlock}

</details>
`.trim();

    const withFullBody = assemble(fullEmailContentBlock);
    if (withFullBody.length <= RICH_MESSAGE_MAX_LENGTH) return withFullBody;

    const fixedOverheadLength = assemble("").length;
    return assemble(truncateEmailContentBlock(fullEmailContentBlock, fixedOverheadLength));
}
