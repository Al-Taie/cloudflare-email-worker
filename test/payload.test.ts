import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRichMarkdownPayload, RICH_MESSAGE_MAX_LENGTH, type RichMarkdownInput } from "../src/payload.ts";

const baseInput: RichMarkdownInput = {
    subject: "Test subject",
    fromFormatted: "📧 `sender@example.com`",
    toFormatted: "📧 `recipient@example.com`",
    dateStr: "📅 **Mon Jan 1 2026**",
    attachmentsBlock: "",
    verificationCode: null,
    displayBody: "Hello world"
};

test("builds a payload under the length limit unchanged", () => {
    const result = buildRichMarkdownPayload(baseInput);
    assert.match(result, /Hello world/);
    assert.ok(result.length <= RICH_MESSAGE_MAX_LENGTH);
});

test("includes the verification code line when present", () => {
    const result = buildRichMarkdownPayload({ ...baseInput, verificationCode: "482910" });
    assert.match(result, /Verification Code.*`482910`/);
});

test("truncates an oversized body instead of exceeding Telegram's limit", () => {
    const hugeBody = "x".repeat(RICH_MESSAGE_MAX_LENGTH * 2);
    const result = buildRichMarkdownPayload({ ...baseInput, displayBody: hugeBody });
    assert.ok(result.length <= RICH_MESSAGE_MAX_LENGTH, `expected <= ${RICH_MESSAGE_MAX_LENGTH}, got ${result.length}`);
    assert.match(result, /truncated/);
});

test("truncation preserves the header table and closing </details> tag", () => {
    const hugeBody = "y".repeat(RICH_MESSAGE_MAX_LENGTH * 3);
    const result = buildRichMarkdownPayload({ ...baseInput, verificationCode: "123456", displayBody: hugeBody });
    assert.match(result, /\*\*From\*\*/);
    assert.match(result, /Verification Code.*`123456`/);
    assert.match(result, /<\/details>$/);
});

test("does not blockquote the body", () => {
    // Regression test: the body used to be wrapped in "> " per line, which
    // caused Telegram to reject a ![](url) media block placed there with
    // RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND in production. Media blocks require
    // the body to render as plain content inside <details>, not a blockquote.
    const result = buildRichMarkdownPayload({ ...baseInput, displayBody: "Line one\nLine two" });
    assert.match(result, /^Line one$/m);
    assert.match(result, /^Line two$/m);
    assert.doesNotMatch(result, /^> /m);
});
