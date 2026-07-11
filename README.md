# forward-workspace-email-to-telegram

A Cloudflare Worker that receives forwarded emails (via [Email Routing](https://developers.cloudflare.com/email-routing/)), extracts a verification/OTP code from the message when present, and forwards it to a Telegram chat topic using the Bot API's [`sendRichMessage`](https://core.telegram.org/bots/api#sendrichmessage) method.

Every email is forwarded — the verification code (🔐) is highlighted when found, otherwise the email is sent as a plain forward (📧) so nothing silently disappears.

## How it works

1. Cloudflare Email Routing invokes the Worker's `email()` handler with the raw MIME message.
2. [`postal-mime`](https://github.com/postalsys/postal-mime) parses the raw message into subject, from/to addresses, date, plain-text/HTML body, and attachments.
3. The body (and subject, as a fallback) is scanned line by line for a verification code:
   - a line containing a keyword (`code`, `otp`, `pin`, `password`, `passcode`) plus a plausible token (digits, or uppercase alphanumeric),
   - or a code on the line immediately following a keyword line ending in `is`/`:`/`-` (e.g. "Your code is:\n\n482 910"),
   - or a bare code-shaped token anywhere in the body when the subject itself signals a code email (e.g. "Your login code") — some templates render the code with no adjacent keyword,
   - or, as a last resort, a standalone 4-8 digit number that isn't a calendar year or part of a date/time.
4. A Rich Markdown message (sender, recipient, date, attachments, collapsible email body) is sent to Telegram via `sendRichMessage`, with the code highlighted when one was found. HTML-only emails have their links/bold/italic/lists preserved instead of being flattened to plain text.
5. Sends are retried with backoff on rate limits (429, honoring Telegram's `retry_after`) and transient 5xx errors. A best-effort dedup check (via the Workers Cache API, keyed by `Message-ID`) skips re-processing if Cloudflare re-invokes the handler for the same email.

## Setup

### Requirements

- A Cloudflare account with [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for your domain.
- A Telegram bot token ([create one via @BotFather](https://core.telegram.org/bots#botfather)) added to the target chat/supergroup, with permission to post.
- Node.js and npm.

### Install

```sh
npm install
```

### Configure

Edit `wrangler.jsonc`:

- `vars.TELEGRAM_CHAT_ID` — target chat ID (negative for supergroups/channels).
- `vars.TELEGRAM_TOPIC_ID` — forum topic (thread) ID within that chat.

Set the bot token as a secret (never commit it to `wrangler.jsonc`):

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

### Local development

```sh
npm run dev
```

### Tests and type checking

```sh
npm test         # runs the unit tests (node:test) against src/*.ts directly
npm run typecheck # tsc --noEmit against the Worker source and the test suite
```

### Deploy

```sh
npm run deploy
```

After deploying, attach the Worker to your domain's Email Routing rules (catch-all or a specific address) from the Cloudflare dashboard — deploying alone does not wire up the email trigger.

## Project structure

Written in TypeScript; Wrangler's esbuild pipeline bundles `src/index.ts` directly, no separate build step needed.

- `src/index.ts` — orchestrates the Worker's `email()` handler: parses the message, wires the pieces below together, sends to Telegram.
- `src/codeExtraction.ts` — verification code detection heuristics.
- `src/richMarkdown.ts` — Rich Markdown escaping and code highlighting.
- `src/htmlContent.ts` — HTML → plain text (for extraction) and HTML → Rich Markdown (for display, preserving links/formatting).
- `src/format.ts` — address/date/attachment formatting for the Telegram message.
- `src/telegram.ts` — `sendRichMessage` delivery with retry/backoff, and Message-ID-based dedup.
- `test/` — `node:test` unit tests for the pure logic (code extraction, markdown escaping, HTML conversion).
- `wrangler.jsonc` — Worker configuration and environment variables.
- `tsconfig.json` / `tsconfig.test.json` — separate programs for Worker source (`@cloudflare/workers-types`) vs. tests (`@types/node`), since the two ambient global sets (e.g. `Request`/`Response`/`caches`) conflict if merged.
