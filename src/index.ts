import PostalMime, { type Email } from "postal-mime";
import { escapeRichMarkdown, highlightCode } from "./richMarkdown.ts";
import { formatAddress, formatAddressList, formatDate, formatAttachments } from "./format.ts";
import { htmlToText, htmlToRichMarkdown } from "./htmlContent.ts";
import { extractVerificationCode } from "./codeExtraction.ts";
import { sendRichMessageWithRetry, isDuplicateMessage } from "./telegram.ts";

interface Env {
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
    TELEGRAM_TOPIC_ID: string;
}

function pickStatusEmoji(subject: string, hasCode: boolean): string {
    const lowerSubject = subject.toLowerCase();
    if (/alert|warning|critical/.test(lowerSubject)) return "⚠️";
    if (/invoice|receipt|payment/.test(lowerSubject)) return "🧾";
    return hasCode ? "🔐" : "📧";
}

interface ResolvedBody {
    bodyText: string;
    displayBody: string;
}

// Plain semantic text (for logging/code extraction) is derived separately
// from the display body (Rich-Markdown-safe, used in the Telegram message) —
// the display body preserves links/bold/lists from HTML instead of flattening
// everything, while extraction only cares about the underlying words.
function resolveBody(parsed: Email): ResolvedBody {
    const plainText = parsed.text?.trim();
    if (plainText) {
        const bodyText = plainText.replace(/\n{3,}/g, "\n\n");
        return { bodyText, displayBody: escapeRichMarkdown(bodyText) };
    }

    if (parsed.html) {
        const bodyText = htmlToText(parsed.html);
        const displayBody = htmlToRichMarkdown(parsed.html);
        return { bodyText: bodyText || "No text content found.", displayBody };
    }

    const bodyText = "No text content found.";
    return { bodyText, displayBody: escapeRichMarkdown(bodyText) };
}

interface RichMarkdownInput {
    subject: string;
    fromFormatted: string;
    toFormatted: string;
    dateStr: string;
    attachmentsBlock: string;
    verificationCode: string | null;
    displayBody: string;
}

function buildRichMarkdownPayload({
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
    const emailContentBlock = processedBody
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");

    return `
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
}

export default {
    async email(message, env) {
        const parsed = await PostalMime.parse(message.raw);

        if (await isDuplicateMessage(parsed.messageId)) {
            console.log(`[Duplicate] Skipping already-processed message ${parsed.messageId}`);
            return;
        }

        const subject = parsed.subject || "(No Subject)";
        const fromFormatted = formatAddress(parsed.from);
        const toFormatted = formatAddressList(parsed.to);
        const dateStr = formatDate(parsed.date);
        const attachmentsBlock = formatAttachments(parsed.attachments);

        const { bodyText, displayBody } = resolveBody(parsed);

        const verificationCode = extractVerificationCode(subject, bodyText);

        const richMarkdownPayload = buildRichMarkdownPayload({
            subject,
            fromFormatted,
            toFormatted,
            dateStr,
            attachmentsBlock,
            verificationCode,
            displayBody
        });

        await sendRichMessageWithRetry(env.TELEGRAM_BOT_TOKEN, {
            chat_id: env.TELEGRAM_CHAT_ID,
            message_thread_id: parseInt(env.TELEGRAM_TOPIC_ID, 10),
            rich_message: {
                markdown: richMarkdownPayload
            }
        });
    }
} satisfies ExportedHandler<Env>;
