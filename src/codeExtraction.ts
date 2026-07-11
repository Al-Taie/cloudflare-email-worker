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
function looksLikeCode(token: string): boolean {
    return /\d/.test(token) || /^[A-Z0-9]+$/.test(token);
}

function findCodeInLine(line: string): string | null {
    if (!/\b(?:code|otp|pin|password|passcode)\b/i.test(line)) return null;

    for (const match of line.matchAll(/\b([A-Za-z0-9]{4,10})\b/g)) {
        const token = match[1] as string;
        if (CODE_STOP_WORDS.has(token.toLowerCase())) continue;
        if (looksLikeCode(token)) return token;
    }
    return null;
}

// If a line ends with a keyword + separator ("Your code is:") the code itself
// often sits alone on the following line, e.g. Slack/Notion-style templates.
function findCodeOnFollowingLine(lines: string[], index: number): string | null {
    const line = (lines[index] ?? "").trim();
    if (!/\b(?:code|otp|pin|password|passcode)\b.*(?:is|:|-)\s*$/i.test(line)) return null;

    for (let i = index + 1; i < lines.length; i++) {
        const next = (lines[i] ?? "").trim();
        if (!next) continue;
        const compact = next.replace(/[\s-]/g, "");
        if (/^[A-Za-z0-9]{4,10}$/.test(compact) && looksLikeCode(compact)) return compact;
        return null;
    }
    return null;
}

function isLikelyYear(token: string): boolean {
    if (!/^\d{4}$/.test(token)) return false;
    const year = parseInt(token, 10);
    return year >= 1990 && year <= 2035;
}

function isAdjacentToDateOrTime(token: string, fullText: string, index: number): boolean {
    const before = fullText.charAt(index - 1);
    const after = fullText.charAt(index + token.length);
    return ["/", "-", ":", "."].includes(before) || ["/", "-", ":", "."].includes(after);
}

function findStandaloneDigitCode(text: string): string | null {
    for (const match of text.matchAll(/\b\d{4,8}\b/g)) {
        const token = match[0];
        if (isLikelyYear(token)) continue;
        if (isAdjacentToDateOrTime(token, text, match.index ?? 0)) continue;
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

function isPlausibleBareCode(token: string): boolean {
    if (!/^[A-Za-z0-9]{4,10}$/.test(token)) return false;
    if (CODE_STOP_WORDS.has(token.toLowerCase())) return false;
    if (STANDARD_CAPITALIZED_WORD.test(token)) return false;
    // Require a digit or an uppercase letter — plain lowercase words are prose,
    // but generated codes (482910, 8F3K9A, iRikgJ) always have one of these.
    return /\d/.test(token) || /[A-Z]/.test(token);
}

// Last resort for templates where the code sits alone in the body with no
// adjacent keyword (e.g. Notion's "iRikgJ" with the keyword only in the subject).
function findBareCodeInBody(subject: string, bodyText: string): string | null {
    if (!SUBJECT_CODE_CONTEXT.test(subject)) return null;

    for (const match of bodyText.matchAll(/\b([A-Za-z0-9]{4,10})\b/g)) {
        const token = match[1] as string;
        if (!isPlausibleBareCode(token)) continue;
        if (/^\d+$/.test(token) && (isLikelyYear(token) || isAdjacentToDateOrTime(token, bodyText, match.index ?? 0))) continue;
        return token;
    }
    return null;
}

export function extractVerificationCode(subject: string, bodyText: string): string | null {
    const bodyLines = bodyText.split("\n");
    for (let i = 0; i < bodyLines.length; i++) {
        const code = findCodeInLine(bodyLines[i] ?? "") || findCodeOnFollowingLine(bodyLines, i);
        if (code) return code;
    }

    const subjectCode = findCodeInLine(subject);
    if (subjectCode) return subjectCode;

    const bareCode = findBareCodeInBody(subject, bodyText);
    if (bareCode) return bareCode;

    return findStandaloneDigitCode(bodyText);
}
