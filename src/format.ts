import type { Address, Attachment } from "postal-mime";
import { escapeRichMarkdown } from "./richMarkdown.ts";

const TIMEZONE = "Asia/Baghdad";

export function formatAddress(address: Address | undefined): string {
    if (!address || !("address" in address) || !address.address) return "`(unknown)`";
    const email = escapeRichMarkdown(address.address).toLowerCase();
    const name = address.name ? escapeRichMarkdown(address.name).replace(/\s+/g, " ").trim() : null;
    return name ? `👤 **${name}**<br>📧 \`${email}\`` : `📧 \`${email}\``;
}

export function formatAddressList(addresses: Address[] | undefined): string {
    if (!addresses || addresses.length === 0) return "`(unknown)`";
    return addresses.map(formatAddress).join("<br>");
}

export function formatDate(dateString: string | undefined): string {
    const d = new Date(dateString ?? "");
    if (isNaN(d.getTime())) return escapeRichMarkdown(dateString || "(unknown)");

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

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentSize(attachment: Attachment): number | null {
    const content = attachment.content;
    if (!content) return null;
    if (typeof content === "string") {
        return attachment.encoding === "base64" ? Math.floor((content.length * 3) / 4) : content.length;
    }
    return "byteLength" in content ? content.byteLength : (content as ArrayLike<number>).length ?? null;
}

// Only lists actual attachments — inline images used within the HTML body
// (logos, signature icons) aren't meaningful to surface as "attachments".
export function formatAttachments(attachments: Attachment[] | undefined): string {
    if (!attachments || attachments.length === 0) return "";
    const listed = attachments.filter((a) => a.disposition !== "inline" && !a.related);
    if (listed.length === 0) return "";

    const lines = listed.map((a) => {
        const name = escapeRichMarkdown(a.filename || "(unnamed)");
        const size = attachmentSize(a);
        const sizeLabel = size != null ? ` (${formatBytes(size)})` : "";
        return `- 📎 \`${name}\`${sizeLabel}`;
    });

    return `\n**Attachments**\n${lines.join("\n")}\n`;
}
