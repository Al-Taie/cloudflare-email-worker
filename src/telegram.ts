async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1500];

export interface RichMessagePayload {
    chat_id: string;
    message_thread_id: number;
    rich_message: {
        markdown: string;
    };
}

interface TelegramErrorBody {
    parameters?: {
        retry_after?: number;
    };
}

// Retries transient Telegram failures (rate limits, 5xx) with backoff;
// non-retryable errors (4xx other than 429) are logged and returned as-is.
export async function sendRichMessageWithRetry(botToken: string, payload: RichMessagePayload): Promise<Response> {
    const url = `https://api.telegram.org/bot${botToken}/sendRichMessage`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let response: Response;
        try {
            response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            if (attempt === MAX_ATTEMPTS) {
                console.error(`Telegram request failed: ${err instanceof Error ? err.message : String(err)}`);
                throw err;
            }
            await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1500);
            continue;
        }

        if (response.ok) return response;

        const errorText = await response.text();
        const isRetryable = response.status === 429 || response.status >= 500;

        if (!isRetryable || attempt === MAX_ATTEMPTS) {
            console.error(`Telegram API Error: ${response.status} - ${errorText}`);
            return response;
        }

        let delay = RETRY_DELAYS_MS[attempt - 1] ?? 1500;
        if (response.status === 429) {
            try {
                const parsedBody = JSON.parse(errorText) as TelegramErrorBody;
                if (parsedBody.parameters?.retry_after) delay = parsedBody.parameters.retry_after * 1000;
            } catch {
                // Keep the default backoff if the error body isn't JSON.
            }
        }

        console.log(
            `[Retry] Telegram send failed with ${response.status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS})`
        );
        await sleep(delay);
    }

    // Unreachable: the loop above always returns or throws by the final attempt.
    throw new Error("Telegram send failed: exhausted retries without a response");
}

// Best-effort de-duplication using the per-colo Cache API, keyed by Message-ID.
// Guards against Cloudflare re-invoking email() on a transient retry causing a
// duplicate Telegram post. Fails open (treats as "not a duplicate") if the
// Cache API is unavailable or the email has no Message-ID.
export async function isDuplicateMessage(messageId: string | undefined): Promise<boolean> {
    if (!messageId) return false;
    try {
        const cache = caches.default;
        const cacheKey = new Request(`https://dedup.internal/email/${encodeURIComponent(messageId)}`);
        const hit = await cache.match(cacheKey);
        if (hit) return true;
        await cache.put(cacheKey, new Response("1", { headers: { "Cache-Control": "max-age=3600" } }));
        return false;
    } catch (err) {
        console.error(`Dedup check failed, proceeding without it: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}
