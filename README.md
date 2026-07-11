# forward-workspace-email-to-telegram

A Cloudflare Worker that receives forwarded emails (via [Email Routing](https://developers.cloudflare.com/email-routing/)), extracts a verification/OTP code from the message, and posts it to a Telegram chat topic using the Bot API's [`sendRichMessage`](https://core.telegram.org/bots/api#sendrichmessage) method.

Emails that don't contain a recognizable verification code are silently dropped, so only actionable messages (login codes, OTPs, 2FA codes, etc.) reach Telegram.

## How it works

1. Cloudflare Email Routing invokes the Worker's `email()` handler with the raw MIME message.
2. [`postal-mime`](https://github.com/postalsys/postal-mime) parses the raw message into subject, from/to addresses, date, and plain-text/HTML body.
3. The body (and subject, as a fallback) is scanned line by line for a verification code:
   - a line containing a keyword (`code`, `otp`, `pin`, `password`, `passcode`) plus a plausible token (digits, or uppercase alphanumeric),
   - or a code on the line immediately following a keyword line ending in `is`/`:`/`-` (e.g. "Your code is:\n\n482 910"),
   - or, as a last resort, a standalone 4-8 digit number that isn't a calendar year or part of a date/time.
4. If no code is found, the email is dropped (logged only).
5. Otherwise, a formatted Rich Markdown message (sender, recipient, date, highlighted code, collapsible email body) is sent to Telegram via `sendRichMessage`.

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

### Deploy

```sh
npm run deploy
```

After deploying, attach the Worker to your domain's Email Routing rules (catch-all or a specific address) from the Cloudflare dashboard — deploying alone does not wire up the email trigger.

## Project structure

- `src/index.js` — the Worker's `email()` handler: MIME parsing, code extraction, Telegram dispatch.
- `wrangler.jsonc` — Worker configuration and environment variables.
