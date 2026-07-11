import PostalMime from "postal-mime";

const TIMEZONE = "Asia/Baghdad";

// Rich Markdown special characters that must be escaped in untrusted content,
// see https://core.telegram.org/bots/api#rich-markdown-style
const escapeRichMarkdown = (str) => (str ?? "").replace(/([\\`*_~=|[\]#$^>])/g, "\\$1");

function formatAddress(address) {
    if (!address) return "`(unknown)`";
    const email = escapeRichMarkdown(address.address || "(unknown)").toLowerCase();
    const name = address.name ? escapeRichMarkdown(address.name).replace(/\s+/g, " ").trim() : null;
    return name ? `👤 **${name}**<br>📧 \`${email}\`` : `📧 \`${email}\``;
}

function formatAddressList(addresses) {
    if (!addresses || addresses.length === 0) return "`(unknown)`";
    return addresses.map(formatAddress).join("<br>");
}

function formatDate(dateString) {
    const d = new Date(dateString);
    if (isNaN(d)) return escapeRichMarkdown(dateString || "(unknown)");

    const date = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: TIMEZONE
    }).format(d);

    const time = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: TIMEZONE
    }).format(d);

    return `📅 **${date}**<br>🕒 **${time}**`;
}

function htmlToText(html) {
    return html
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// Common words that would otherwise be mistaken for a code when they sit on a
// line together with a keyword like "code" (e.g. "Your verification code is below").
const CODE_STOP_WORDS = new Set([
    "code", "codes", "otp", "pin", "pins", "password", "passcode",
    "your", "you", "this", "the", "a", "an", "is", "are", "was", "be",
    "use", "using", "used", "enter", "below", "above", "here", "from", "with",
    "team", "security", "verification", "verify", "confirm", "confirmation",
    "login", "log", "access", "auth", "authentication", "signing", "sign",
    "share", "anyone", "never", "will", "please", "request", "requested",
    "address", "email", "support", "help", "service", "provide", "given",
    "account", "valid", "expire", "expires", "expired", "minutes", "seconds",
    "hours", "now", "device", "one", "time"
]);

// A token counts as a plausible code if it contains a digit, or if it's a run
// of uppercase letters/digits (typical for alphanumeric codes like "8F3K9A").
function looksLikeCode(token) {
    return /\d/.test(token) || /^[A-Z0-9]+$/.test(token);
}

function findCodeInLine(line) {
    if (!/\b(?:code|otp|pin|password|passcode)\b/i.test(line)) return null;

    for (const match of line.matchAll(/\b([A-Za-z0-9]{4,10})\b/g)) {
        const token = match[1];
        if (CODE_STOP_WORDS.has(token.toLowerCase())) continue;
        if (looksLikeCode(token)) return token;
    }
    return null;
}

// If a line ends with a keyword + separator ("Your code is:") the code itself
// often sits alone on the following line, e.g. Slack/Notion-style templates.
function findCodeOnFollowingLine(lines, index) {
    const line = lines[index].trim();
    if (!/\b(?:code|otp|pin|password|passcode)\b.*(?:is|:|-)\s*$/i.test(line)) return null;

    for (let i = index + 1; i < lines.length; i++) {
        const next = lines[i].trim();
        if (!next) continue;
        const compact = next.replace(/[\s-]/g, "");
        if (/^[A-Za-z0-9]{4,10}$/.test(compact) && looksLikeCode(compact)) return compact;
        return null;
    }
    return null;
}

function isLikelyYear(token) {
    if (!/^\d{4}$/.test(token)) return false;
    const year = parseInt(token, 10);
    return year >= 1990 && year <= 2035;
}

function isAdjacentToDateOrTime(token, fullText, index) {
    const before = fullText.charAt(index - 1);
    const after = fullText.charAt(index + token.length);
    return ["/", "-", ":", "."].includes(before) || ["/", "-", ":", "."].includes(after);
}

function findStandaloneDigitCode(text) {
    for (const match of text.matchAll(/\b\d{4,8}\b/g)) {
        const token = match[0];
        if (isLikelyYear(token)) continue;
        if (isAdjacentToDateOrTime(token, text, match.index)) continue;
        return token;
    }
    return null;
}

// Whether the subject line itself signals "this email carries a code", used to
// license the bare-token fallback below (some templates render the code as the
// only content in the body, with no "code:" keyword next to it).
const SUBJECT_CODE_CONTEXT =
    /\b(?:code|otp|pin|password|passcode|verification|verify|confirm|confirmation|login|log-in|sign-in|authentication|2fa|one-time|one time)\b/i;

// A standard capitalized word ("Hello", "Notion") is just prose, not a code.
const STANDARD_CAPITALIZED_WORD = /^[A-Z][a-z]+$/;

function isPlausibleBareCode(token) {
    if (!/^[A-Za-z0-9]{4,10}$/.test(token)) return false;
    if (CODE_STOP_WORDS.has(token.toLowerCase())) return false;
    if (STANDARD_CAPITALIZED_WORD.test(token)) return false;
    // Require a digit or an uppercase letter — plain lowercase words are prose,
    // but generated codes (482910, 8F3K9A, iRikgJ) always have one of these.
    return /\d/.test(token) || /[A-Z]/.test(token);
}

// Last resort for templates where the code sits alone in the body with no
// adjacent keyword (e.g. Notion's "iRikgJ" with the keyword only in the subject).
function findBareCodeInBody(subject, bodyText) {
    if (!SUBJECT_CODE_CONTEXT.test(subject)) return null;

    for (const match of bodyText.matchAll(/\b([A-Za-z0-9]{4,10})\b/g)) {
        const token = match[1];
        if (!isPlausibleBareCode(token)) continue;
        if (/^\d+$/.test(token) && (isLikelyYear(token) || isAdjacentToDateOrTime(token, bodyText, match.index))) continue;
        return token;
    }
    return null;
}

function extractVerificationCode(subject, bodyText) {
    const bodyLines = bodyText.split("\n");
    for (let i = 0; i < bodyLines.length; i++) {
        const code = findCodeInLine(bodyLines[i]) || findCodeOnFollowingLine(bodyLines, i);
        if (code) return code;
    }

    const subjectCode = findCodeInLine(subject);
    if (subjectCode) return subjectCode;

    const bareCode = findBareCodeInBody(subject, bodyText);
    if (bareCode) return bareCode;

    return findStandaloneDigitCode(bodyText);
}

function highlightCode(escapedText, rawCode) {
    if (!rawCode) return escapedText;
    const escapedCode = escapeRichMarkdown(rawCode);
    const pattern = escapedCode.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return escapedText.replace(new RegExp(`\\b${pattern}\\b`, "g"), `\`${rawCode}\``);
}

export default {
    async email(message, env) {
        const parsed = await PostalMime.parse(message.raw);

        const subject = parsed.subject || "(No Subject)";
        const fromFormatted = formatAddress(parsed.from);
        const toFormatted = formatAddressList(parsed.to);
        const dateStr = formatDate(parsed.date);

        let bodyText = parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : "");
        if (!bodyText) bodyText = "No text content found.";
        bodyText = bodyText.replace(/\n{3,}/g, "\n\n");

        console.log(
            `[Received] From: ${parsed.from?.address || "(unknown)"} | To: ${(parsed.to || []).map((a) => a.address).join(", ") || "(unknown)"} | Subject: "${subject}" | Date: ${parsed.date || "(unknown)"}\n${bodyText}`
        );

        const verificationCode = extractVerificationCode(subject, bodyText);

        if (!verificationCode) {
            console.log(`[Dropped] Email skipped. No verification token extracted. Subject: "${subject}"`);
            return;
        }

        const lowerSubject = subject.toLowerCase();
        let statusEmoji = "🔐";
        if (/alert|warning|critical/.test(lowerSubject)) {
            statusEmoji = "⚠️";
        } else if (/invoice|receipt|payment/.test(lowerSubject)) {
            statusEmoji = "🧾";
        }

        const otpHeaderBlock = `\n🔑 **Verification Code:** \`${verificationCode}\` \n`;

        const escapedBody = escapeRichMarkdown(bodyText);
        const processedBody = highlightCode(escapedBody, verificationCode);
        const emailContentBlock = processedBody
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");

        const richMarkdownPayload = `
### ${statusEmoji} Email: ${escapeRichMarkdown(subject)}

| Field | Information |
| :--- | :--- |
| **From** | ${fromFormatted} |
| **To** | ${toFormatted} |
| **Date** | ${dateStr} |
${otpHeaderBlock}
<details>
<summary> Email Content</summary>

${emailContentBlock}

</details>
`.trim();

        const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendRichMessage`;

        const payload = {
            chat_id: env.TELEGRAM_CHAT_ID,
            message_thread_id: parseInt(env.TELEGRAM_TOPIC_ID, 10),
            rich_message: {
                markdown: richMarkdownPayload
            }
        };

        const response = await fetch(telegramUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Telegram API Error: ${response.status} - ${errorText}`);
        }
    }
};
