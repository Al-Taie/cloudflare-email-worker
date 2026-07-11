import { escapeRichMarkdown } from "./richMarkdown.ts";

// Common named entities beyond the XML-standard five, since HTML emails
// routinely use these (copyright notices, typographic dashes/quotes, CTA
// arrows like "Read more &rarr;", currency symbols) and leaving them
// undecoded ("&copy;", "&rarr;") reads as broken.
const NAMED_ENTITIES: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    copy: "©", reg: "®", trade: "™",
    ndash: "–", mdash: "—", hellip: "…",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    middot: "·", bull: "•",
    rarr: "→", larr: "←", uarr: "↑", darr: "↓", harr: "↔",
    rArr: "⇒", lArr: "⇐", hArr: "⇔",
    times: "×", divide: "÷", plusmn: "±", deg: "°",
    sect: "§", para: "¶", dagger: "†", Dagger: "‡", permil: "‰",
    euro: "€", pound: "£", yen: "¥", cent: "¢",
    infin: "∞", ne: "≠", le: "≤", ge: "≥"
};

const MAX_ENTITY_DECODE_PASSES = 5;

// Try an exact-case match first (HTML entity names are technically
// case-sensitive — &rArr; and &rarr; are different characters), falling
// back to a lowercase match since most real-world entities in email are
// written lowercase and authors are often loose about casing anyway.
//
// Decoding repeats until the string stabilizes (bounded) because some
// senders double-encode a value before inserting it into HTML — e.g. a URL
// that already had "&" escaped to "&amp;" gets escaped *again* when placed
// in an href, producing "&amp;amp;". A single decode pass only unwinds one
// level, leaving a literal "&amp;" in the output (observed in production
// with a Postdrop link).
const decodeEntitiesOnce = (s: string): string =>
    s
        .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? match);

function decodeEntities(s: string): string {
    let decoded = s;
    for (let pass = 0; pass < MAX_ENTITY_DECODE_PASSES; pass++) {
        const next = decodeEntitiesOnce(decoded);
        if (next === decoded) break;
        decoded = next;
    }
    return decoded;
}

// Email templates are almost always indentation-heavy HTML tables; stripping
// tags alone leaves the original indentation whitespace behind as literal
// text, producing walls of near-blank lines. Trim each line and collapse
// runs of blank lines down to at most one, after tags are gone.
function collapseWhitespace(text: string): string {
    return text
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// Images carry no text content, so a bare <img> disappears silently unless
// its alt text is pulled out — that alt text is often the only description
// of a hero banner or product photo in a marketing email. Used as the
// fallback for images that aren't promoted to a real media block (see
// convertStandaloneImages below), and for any image nested inside inline
// formatting or a table cell, where a media block isn't valid Rich Markdown.
const extractImageAlt = (html: string): string =>
    html.replace(/<img[^>]*\balt=["']([^"']*)["'][^>]*\/?>/gi, (_match, alt: string) => (alt.trim() ? ` ${alt.trim()} ` : ""));

const HIDDEN_STYLE_PATTERN = /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all/i;

// Marketing emails routinely hide preheader/tracking text via inline styles
// (display:none, visibility:hidden, or Outlook's mso-hide:all) — without
// stripping it, that invisible text leaks into the forwarded message.
// Regex-based, so this only handles non-nested hidden elements (the common
// case: a single <span>/<div> with no same-named tag inside it). A hidden
// element that itself contains another element of the same tag name only
// has its content removed up to that inner element's closing tag; the
// remainder is left as ordinary content — a safe fallback, not data loss.
// Every closing-tag pattern below allows whitespace before the final ">"
// (e.g. "</a\s*>" not "</a>"): Prettier-formatted email templates routinely
// split a closing tag's ">" onto its own line ("</a\n>"), which is valid
// HTML but doesn't match a literal "</a>". Missing that caused a real
// production bug — a split "</a>" on a button link made the non-greedy
// inner-content match skip past it to the next (unrelated) "</a>" later in
// the document, merging two separate links into one garbled token.
function stripHiddenElements(html: string): string {
    return html.replace(
        /<(\w+)\b[^>]*\bstyle=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1\s*>/gi,
        (full: string, _tag: string, style: string) => (HIDDEN_STYLE_PATTERN.test(style) ? "" : full)
    );
}

// Flattens HTML to plain semantic text — used for logging and for verification
// code extraction, where formatting doesn't matter.
export function htmlToText(html: string): string {
    return collapseWhitespace(
        decodeEntities(
            extractImageAlt(stripHiddenElements(html))
                .replace(/<head[^>]*>[\s\S]*?<\/head\s*>/gi, "")
                .replace(/<style[^>]*>[\s\S]*?<\/style\s*>/gi, "")
                .replace(/<script[^>]*>[\s\S]*?<\/script\s*>/gi, "")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/(p|div|tr|td|th|li|h[1-6])\s*>/gi, "\n")
                .replace(/<[^>]+>/g, "")
        )
    );
}

const stripTags = (s: string): string => decodeEntities(extractImageAlt(s).replace(/<[^>]+>/g, ""));

// Shared between the top-level document pipeline and the table-cell
// converter below, so both apply the exact same link/formatting rules.
const LINK_PATTERN = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
const SAFE_HREF_PATTERN = /^(https?:|mailto:|tel:)/i;

// HTML-attribute escaping for the href — "&" must become "&amp;" (the
// correct way to represent a literal "&" in an attribute; a parser decodes
// it back before navigating) and '"' must be escaped since the value sits
// inside a double-quoted attribute.
const escapeHtmlAttribute = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// KNOWN TELEGRAM BUG (as of Bot API 10.1, June 2026), not fixable on our
// side: any multi-param URL (one with "&" in the query string) that Telegram
// renders in a Rich Message link comes out with a mangled "&amp;" in the
// actual navigation target — confirmed from production logs that OUR
// outgoing payload contains a correct, properly-formed URL each time
// (verified for both Markdown [text](url) syntax with a raw "&", and HTML
// <a href="..."> syntax with the spec-correct "&amp;" escaping below — both
// independently show the exact same corruption on Telegram's end). Since
// switching syntax didn't help, this points to a bug in Telegram's Rich
// Message renderer itself, most likely in the "Open this link?" confirmation
// dialog / click-through path, not in how we build the link. HTML anchors
// are still used here (rather than reverting to Markdown syntax) because
// they're the more spec-correct form and also avoid a separate, real bug
// this code used to have: stripping '(' / ')' out of the URL entirely
// (Markdown's [text](url) syntax requires escaping — not deleting — those
// characters). If Telegram fixes the underlying renderer bug, this code
// should already be correct with no further changes needed.
function buildLinkMarkdown(text: string, href: string): string {
    return `<a href="${escapeHtmlAttribute(href)}">${text}</a>`;
}

// Inner content is restricted to "no more '<'" so each rule only matches
// leaf-level tags (no nested formatting inside). Combined with the repeated-
// pass loops below, this resolves nesting from the inside out: <b>Bold
// <i>x</i></b> doesn't match the bold rule on the first pass (its content
// still contains '<'), so the italic rule converts the leaf <i>x</i> first;
// only then does the bold tag become leaf-level and get wrapped on the next
// pass. Without this, a single greedy pass over <b>...</b> would swallow a
// nested <i>...</i> as plain text and silently drop the italics.
const INLINE_TAG_RULES: Array<{ regex: RegExp; open: string; close: string }> = [
    { regex: /<(?:b|strong)[^>]*>([^<]*)<\/(?:b|strong)\s*>/gi, open: "**", close: "**" },
    { regex: /<(?:i|em)[^>]*>([^<]*)<\/(?:i|em)\s*>/gi, open: "*", close: "*" },
    { regex: /<(?:u|ins)[^>]*>([^<]*)<\/(?:u|ins)\s*>/gi, open: "<u>", close: "</u>" },
    { regex: /<(?:s|strike|del)[^>]*>([^<]*)<\/(?:s|strike|del)\s*>/gi, open: "~~", close: "~~" },
    { regex: /<code[^>]*>([^<]*)<\/code\s*>/gi, open: "`", close: "`" }
];

const MAX_TOKEN_RESOLUTION_PASSES = 25;

// U+0000 (NUL) can't occur in real email text/HTML, so wrapping an index in
// NUL bytes is a safe, collision-free placeholder. A visible-character
// delimiter (e.g. whitespace-digit-whitespace) is NOT safe here: real content
// like a table cell reading "Qty 3 items" or an <img alt="Product 1"> would
// collide with token index 3/1 and get corrupted by the substitution below.
const TOKEN_PATTERN = / (\d+) /g;
const tokenFor = (index: number): string => ` ${index} `;

function resolveTokens(text: string, tokens: string[]): string {
    let resolved = text;
    for (let pass = 0; pass < MAX_TOKEN_RESOLUTION_PASSES; pass++) {
        const next = resolved.replace(TOKEN_PATTERN, (_match, i: string) => tokens[Number(i)] ?? "");
        if (next === resolved) break;
        resolved = next;
    }
    return resolved;
}

// Telegram: "Table cells can contain only inline formatting" — no media,
// headings, lists, or blockquotes. This converts links and bold/italic/
// underline/strike/code inside a cell to Rich Markdown, then flattens
// anything else (images become alt text, any other tag is stripped).
function convertInlineFormatting(html: string): string {
    let fragment = html;
    const tokens: string[] = [];
    const stash = (value: string): string => {
        const key = tokenFor(tokens.length);
        tokens.push(value);
        return key;
    };

    fragment = fragment.replace(LINK_PATTERN, (_match, href: string, inner: string) => {
        // HTML requires "&" inside an attribute value to be written as
        // "&amp;" (e.g. href="...?a=1&amp;b=2"), so the raw captured href
        // must have its entities decoded before use — otherwise a literal
        // "&amp;" ends up embedded in the URL instead of a real "&",
        // breaking multi-param links (observed in production: a Postdrop
        // verify-recipient URL with "&amp;id=..." in the query string).
        const trimmedHref = decodeEntities(href).trim();
        const text = escapeRichMarkdown(stripTags(inner)).trim();
        if (!text) return "";
        if (!SAFE_HREF_PATTERN.test(trimmedHref)) return stash(text);
        return stash(buildLinkMarkdown(text, trimmedHref));
    });

    for (let pass = 0; pass < MAX_TOKEN_RESOLUTION_PASSES; pass++) {
        let changed = false;
        for (const rule of INLINE_TAG_RULES) {
            fragment = fragment.replace(rule.regex, (_match, inner: string) => {
                changed = true;
                return stash(`${rule.open}${escapeRichMarkdown(stripTags(inner))}${rule.close}`);
            });
        }
        if (!changed) break;
    }

    const remainingEscaped = escapeRichMarkdown(decodeEntities(extractImageAlt(fragment).replace(/<[^>]+>/g, "")));
    return resolveTokens(remainingEscaped, tokens).replace(/\s+/g, " ").trim();
}

function renderTableCell(cellHtml: string): string {
    return convertInlineFormatting(cellHtml) || " ";
}

// Regex-based cell parsing can't safely handle a table nested inside another
// table (a common email layout pattern), so nested tables are rejected
// outright and fall through to the generic td/tr-to-newline flattening
// below instead of risking a garbled render.
function parseDataTableRows(tableHtml: string): string[][] | null {
    const body = tableHtml.replace(/^<table\b[^>]*>/i, "").replace(/<\/table\s*>\s*$/i, "");
    if (/<table\b/i.test(body)) return null;

    const rows: string[][] = [];
    for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
        const rowHtml = rowMatch[1] ?? "";
        const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map((m) => renderTableCell(m[1] ?? ""));
        if (cells.length === 0) return null;
        rows.push(cells);
    }

    // Only treat it as real tabular data, not a single-row/single-column
    // layout wrapper — which is how most email HTML actually uses <table>.
    if (rows.length < 2) return null;
    const columnCount = rows[0]?.length ?? 0;
    if (columnCount < 2 || !rows.every((r) => r.length === columnCount)) return null;

    return rows;
}

function renderMarkdownTable(rows: string[][]): string {
    const [header, ...body] = rows;
    if (!header) return "";
    const separator = header.map(() => ":---");
    const lines = [`| ${header.join(" | ")} |`, `| ${separator.join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)];
    return `\n${lines.join("\n")}\n`;
}

// Cap how many images become real media blocks per message: Rich Messages
// allow up to 50 total, but a handful is plenty to show the hero
// banner/product photos without risking that limit or bloating the message.
const MAX_MEDIA_BLOCKS = 5;
// Below this pixel size (in either dimension, when specified), treat the
// image as a decorative icon/spacer rather than real content.
const MIN_MEDIA_DIMENSION = 40;
// Telegram's photo pipeline requires an actual raster image — it does not
// accept SVG. Verified in production: a placehold.co URL (content-type
// image/svg+xml) sent as a media block failed with
// RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND, while a real .png from another host
// worked. Since fetching each URL to check its Content-Type isn't practical
// here, only promote URLs whose path visibly ends in a known raster
// extension — this also excludes extension-less/query-string-only URLs
// (like placehold.co's) that can't be verified as raster images at all.
const RASTER_IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i;

interface ParsedImg {
    src: string | null;
    alt: string;
    width: number | null;
    height: number | null;
}

function parseImgTag(tag: string): ParsedImg {
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    const widthMatch = tag.match(/\bwidth=["']?(\d+)/i);
    const heightMatch = tag.match(/\bheight=["']?(\d+)/i);
    return {
        src: srcMatch?.[1]?.trim() ?? null,
        alt: altMatch?.[1]?.trim() ?? "",
        width: widthMatch?.[1] ? parseInt(widthMatch[1], 10) : null,
        height: heightMatch?.[1] ? parseInt(heightMatch[1], 10) : null
    };
}

function isEligibleForMediaBlock(img: ParsedImg): boolean {
    if (!img.src) return false;
    if (!/^https?:\/\//i.test(img.src)) return false;
    if (!RASTER_IMAGE_EXTENSION_PATTERN.test(img.src)) return false;
    if (img.width !== null && img.width < MIN_MEDIA_DIMENSION) return false;
    if (img.height !== null && img.height < MIN_MEDIA_DIMENSION) return false;
    return true;
}

// Converts a safe subset of HTML (links, bold/italic/underline/strike, code,
// data tables, paragraphs/lists) into Telegram Rich Markdown instead of
// flattening everything to plain text. Formatting is generated via
// placeholder tokens so the final escape pass over leftover plain text can't
// mangle the markdown syntax being produced here — tags are resolved to
// markdown first, escaped individually, then stashed behind a token; only
// after the rest of the document has been escaped are the tokens
// substituted back in.
export function htmlToRichMarkdown(html: string): string {
    let src = stripHiddenElements(html)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<head[^>]*>[\s\S]*?<\/head\s*>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style\s*>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script\s*>/gi, "");

    const tokens: string[] = [];
    const stash = (value: string): string => {
        const key = tokenFor(tokens.length);
        tokens.push(value);
        return key;
    };

    // Data tables (>=2 rows, >=2 consistent columns) render as real Rich
    // Markdown tables; anything else (the single-row/column layout tables
    // email HTML abuses constantly) falls through to the generic td/tr
    // flattening further down.
    src = src.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, (full: string) => {
        const rows = parseDataTableRows(full);
        return rows ? stash(renderMarkdownTable(rows)) : full;
    });

    // Links: [text](href) — only allow http(s)/mailto/tel to avoid unsafe
    // schemes. Consumes any image nested inside the link (its alt text
    // becomes the link label), so such images never reach the standalone
    // media-block pass below — a linked banner stays a clickable label
    // rather than an unlinked floating image.
    src = src.replace(LINK_PATTERN, (_match, href: string, inner: string) => {
        // HTML requires "&" inside an attribute value to be written as
        // "&amp;" (e.g. href="...?a=1&amp;b=2"), so the raw captured href
        // must have its entities decoded before use — otherwise a literal
        // "&amp;" ends up embedded in the URL instead of a real "&",
        // breaking multi-param links (observed in production: a Postdrop
        // verify-recipient URL with "&amp;id=..." in the query string).
        const trimmedHref = decodeEntities(href).trim();
        const text = escapeRichMarkdown(stripTags(inner)).trim();
        if (!text) return "";
        if (!SAFE_HREF_PATTERN.test(trimmedHref)) return stash(text);
        return stash(buildLinkMarkdown(text, trimmedHref));
    });

    // Remaining standalone <img> tags (hero banners, product photos — not
    // inside a link or a converted data table, both already consumed above)
    // become real Rich Markdown media blocks up to MAX_MEDIA_BLOCKS, so the
    // forwarded message actually shows the image instead of just its alt
    // text. Ineligible images (SVG, non-raster, too small, or not http(s))
    // fall back to alt text as before.
    let mediaBlockCount = 0;
    src = src.replace(/<img\b[^>]*>/gi, (tag: string) => {
        const img = parseImgTag(tag);
        if (img.src && isEligibleForMediaBlock(img) && mediaBlockCount < MAX_MEDIA_BLOCKS) {
            mediaBlockCount++;
            const caption = img.alt ? ` "${img.alt.replace(/"/g, "'")}"` : "";
            return stash(`\n![](${img.src}${caption})\n`);
        }
        return img.alt ? ` ${img.alt} ` : "";
    });

    for (let pass = 0; pass < MAX_TOKEN_RESOLUTION_PASSES; pass++) {
        let changed = false;
        for (const rule of INLINE_TAG_RULES) {
            src = src.replace(rule.regex, (_match, inner: string) => {
                changed = true;
                return stash(`${rule.open}${escapeRichMarkdown(stripTags(inner))}${rule.close}`);
            });
        }
        if (!changed) break;
    }

    src = src
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|td|th|h[1-6])\s*>/gi, "\n")
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/li\s*>/gi, "\n");

    const remainingEscaped = escapeRichMarkdown(decodeEntities(src.replace(/<[^>]+>/g, "")));

    return collapseWhitespace(resolveTokens(remainingEscaped, tokens));
}
