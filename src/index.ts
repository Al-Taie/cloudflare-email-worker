import PostalMime, { type Email } from "postal-mime";
import { escapeRichMarkdown } from "./richMarkdown.ts";
import { formatAddress, formatAddressList, formatDate, formatAttachments } from "./format.ts";
import { htmlToText, htmlToRichMarkdown } from "./htmlContent.ts";
import { extractVerificationCode } from "./codeExtraction.ts";
import { sendRichMessageWithRetry, isDuplicateMessage } from "./telegram.ts";
import { buildRichMarkdownPayload } from "./payload.ts";

interface Env {
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
    TELEGRAM_TOPIC_ID: string;
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

        // Temporary diagnostic: log the exact payload we're about to send,
        // to compare what this code actually produces against what
        // Telegram ends up rendering/navigating to.
        console.log(`[Outgoing payload]\n${richMarkdownPayload}`);

        await sendRichMessageWithRetry(env.TELEGRAM_BOT_TOKEN, {
            chat_id: env.TELEGRAM_CHAT_ID,
            message_thread_id: parseInt(env.TELEGRAM_TOPIC_ID, 10),
            rich_message: {
                markdown: richMarkdownPayload
            }
        });
    }
} satisfies ExportedHandler<Env>;
