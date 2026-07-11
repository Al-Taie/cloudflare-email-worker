import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVerificationCode } from "../src/codeExtraction.ts";

test("finds a numeric code stated inline", () => {
    const body = "Your Google verification code is 482910\n\nDon't share this code with anyone.";
    assert.equal(extractVerificationCode("Your verification code", body), "482910");
});

test("finds a code after a colon", () => {
    const body = "OTP: 738291\n\nThis OTP is valid for 10 minutes.";
    assert.equal(extractVerificationCode("Your OTP for order confirmation", body), "738291");
});

test("finds an alphanumeric code", () => {
    const body = "Here's your verification code: 8F3K9A\n\nUse this code to finish signing in.";
    assert.equal(extractVerificationCode("Your GitHub launch code", body), "8F3K9A");
});

test("finds a code inside HTML-derived plain text", () => {
    const body = "Use the following security code: 519384\nThis is valid until 2026-07-11.";
    assert.equal(extractVerificationCode("Microsoft account security code", body), "519384");
});

test("returns null when there is no code", () => {
    const body = "Here are the top stories from this week in 2026. Check out our new article about 5G networks.";
    assert.equal(extractVerificationCode("Weekly digest", body), null);
});

test("finds a code that sits alone on the line after the keyword line", () => {
    const body = "Your confirmation code is:\n\n482 910\n\nEnter this code to confirm your email.";
    assert.equal(extractVerificationCode("Your Slack confirmation code", body), "482910");
});

test("ignores a nearby date and picks the real code", () => {
    const body = "Transaction date: 07/11/2026\n\nYour one-time passcode is 615203. Valid until 2026.";
    assert.equal(extractVerificationCode("Your one-time passcode", body), "615203");
});

test("finds a bare mixed-case code with no in-body keyword, via subject context", () => {
    // Regression test: Notion sends the code as the entire body with no
    // "code:" label anywhere near it — only the subject signals the context.
    assert.equal(extractVerificationCode("Your temporary Notion login code", "iRikgJ"), "iRikgJ");
});

test("does not treat a brand name in the subject as license to grab any capitalized word", () => {
    const body = "Hello Ahmed, here is your weekly summary of Notion pages.";
    assert.equal(extractVerificationCode("Weekly Notion digest", body), null);
});

test("ignores a standalone calendar year", () => {
    const body = "Copyright 2026. All rights reserved.";
    assert.equal(extractVerificationCode("Newsletter", body), null);
});
