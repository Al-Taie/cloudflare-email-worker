import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeRichMarkdown, highlightCode } from "../src/richMarkdown.ts";

test("escapes Rich Markdown special characters", () => {
    // "%" isn't in Telegram's Rich Markdown special-character set — only
    // \ ` * _ ~ = | [ ] # $ ^ > need escaping.
    assert.equal(escapeRichMarkdown("100% *important* [link]"), "100% \\*important\\* \\[link\\]");
});

test("escape is a no-op for plain text", () => {
    assert.equal(escapeRichMarkdown("hello world"), "hello world");
});

test("handles null/undefined input", () => {
    assert.equal(escapeRichMarkdown(undefined), "");
    assert.equal(escapeRichMarkdown(null), "");
});

test("highlightCode wraps the code in backticks", () => {
    assert.equal(highlightCode("Your code is 482910 today", "482910"), "Your code is `482910` today");
});

test("highlightCode only matches whole-word occurrences", () => {
    assert.equal(highlightCode("Code 12 vs 1234", "12"), "Code `12` vs 1234");
});

test("highlightCode is a no-op without a code", () => {
    assert.equal(highlightCode("Some escaped text", null), "Some escaped text");
});
