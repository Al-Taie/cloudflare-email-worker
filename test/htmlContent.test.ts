import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, htmlToRichMarkdown } from "../src/htmlContent.ts";

test("htmlToText strips tags and decodes entities", () => {
    const html = "<p>Hello <b>World</b> &amp; friends</p>";
    assert.equal(htmlToText(html), "Hello World & friends");
});

test("htmlToText drops head/style/script content", () => {
    const html = "<head><title>x</title></head><style>.a{color:red}</style><script>alert(1)</script><p>Body text</p>";
    assert.equal(htmlToText(html), "Body text");
});

test("htmlToRichMarkdown converts bold/italic/links", () => {
    const html = '<p>Use the following security code: <b>519384</b></p><p>See <a href="https://example.com">details</a>.</p>';
    const result = htmlToRichMarkdown(html);
    assert.match(result, /\*\*519384\*\*/);
    assert.match(result, /\[details\]\(https:\/\/example\.com\)/);
});

test("htmlToRichMarkdown escapes special characters in plain text but not generated markdown", () => {
    // "%" isn't in Telegram's Rich Markdown special-character set — only
    // \ ` * _ ~ = | [ ] # $ ^ > need escaping.
    const html = "<p>100% off *today* only</p>";
    const result = htmlToRichMarkdown(html);
    assert.equal(result, "100% off \\*today\\* only");
});

test("htmlToRichMarkdown drops unsafe link schemes but keeps the text", () => {
    const html = '<a href="javascript:alert(1)">click me</a>';
    const result = htmlToRichMarkdown(html);
    assert.equal(result, "click me");
    assert.doesNotMatch(result, /javascript:/);
});

test("htmlToRichMarkdown handles nested formatting inside a link-free bold tag", () => {
    const html = "<b>Bold <i>and italic</i> text</b>";
    const result = htmlToRichMarkdown(html);
    assert.equal(result, "**Bold *and italic* text**");
});

test("htmlToRichMarkdown does not corrupt plain numbers that look like tokens", () => {
    const html = "<p>I have 5 apples and <b>bold text</b></p>";
    const result = htmlToRichMarkdown(html);
    assert.match(result, /I have 5 apples/);
    assert.match(result, /\*\*bold text\*\*/);
});

test("decodes common named entities beyond the XML five", () => {
    const html = "<p>&copy; NinuSoft &ndash; All rights reserved &mdash; est. 1999&hellip;</p>";
    assert.equal(htmlToText(html), "© NinuSoft – All rights reserved — est. 1999…");
});

test("decodes numeric entities, decimal and hex", () => {
    assert.equal(htmlToText("&#169; &#x2013;"), "© –");
});

test("extracts image alt text instead of silently dropping the image", () => {
    const html = '<img src="banner.jpg" alt="Up to 40% Off Summer Sale">';
    assert.equal(htmlToText(html), "Up to 40% Off Summer Sale");
});

test("does not corrupt output when image alt text contains a small integer", () => {
    // Regression test: an <img alt="Product 1"> was colliding with the
    // internal placeholder-token scheme and mangling unrelated later text.
    const html =
        '<table><tr><td><img alt="Product 1"><p>Beach Umbrella</p></td>' +
        '<td><img alt="Product 2"><p>Sunscreen</p></td></tr></table><a href="https://example.com">Unsubscribe</a>';
    const result = htmlToRichMarkdown(html);
    assert.match(result, /Product 1[\s\S]*Beach Umbrella/);
    assert.match(result, /Product 2[\s\S]*Sunscreen/);
    assert.match(result, /\[Unsubscribe\]\(https:\/\/example\.com\)/);
    assert.doesNotMatch(result, /ProductUnsubscribe/);
});

test("collapses indentation whitespace from table-heavy email markup instead of a wall of blank lines", () => {
    const html = `
        <table>
          <tr>
            <td>
              <p>Beach Umbrella</p>
            </td>
          </tr>
        </table>
    `;
    const result = htmlToText(html);
    assert.equal(result, "Beach Umbrella");
    assert.doesNotMatch(result, /\n{3,}/);
});

test("strips display:none preheader/tracking text", () => {
    const html =
        '<span style="display:none">Hidden preheader text</span><p>Visible content</p>';
    const result = htmlToText(html);
    assert.equal(result, "Visible content");
    assert.doesNotMatch(result, /Hidden preheader/);
});

test("strips visibility:hidden and Outlook mso-hide:all content", () => {
    assert.equal(htmlToText('<div style="visibility:hidden">gone</div><p>kept</p>'), "kept");
    assert.equal(htmlToText('<div style="mso-hide:all">gone</div><p>kept</p>'), "kept");
});

test("keeps content in an element with an unrelated style", () => {
    const html = '<p style="color:red">Still visible</p>';
    assert.equal(htmlToText(html), "Still visible");
});

test("renders a genuine data table (>=2 rows, >=2 columns) as a Rich Markdown table", () => {
    const html = `
        <table>
          <tr><th>Item</th><th>Price</th></tr>
          <tr><td>Umbrella</td><td>$20</td></tr>
          <tr><td>Cooler</td><td>$35</td></tr>
        </table>
    `;
    const result = htmlToRichMarkdown(html);
    assert.match(result, /\| Item \| Price \|/);
    assert.match(result, /\| :--- \| :--- \|/);
    // "$" is in Telegram's Rich Markdown special-character set, so cell
    // content containing it is correctly escaped to "\$20".
    assert.match(result, /\| Umbrella \| \\\$20 \|/);
    assert.match(result, /\| Cooler \| \\\$35 \|/);
});

test("does not render a single-row layout table as a markdown table", () => {
    const html = "<table><tr><td>Logo</td><td>Banner</td></tr></table>";
    const result = htmlToRichMarkdown(html);
    assert.doesNotMatch(result, /\| :--- \|/);
    assert.match(result, /Logo/);
    assert.match(result, /Banner/);
});

test("falls back to flattening when a table is nested inside another table", () => {
    const html = `
        <table><tr><td>
          <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
        </td></tr></table>
    `;
    const result = htmlToRichMarkdown(html);
    // Nested tables aren't safely parseable with regex, so this should not
    // produce a markdown table — just fall through without corrupting output.
    assert.doesNotMatch(result, /\| :--- \|/);
});

test("preserves inline formatting inside a table cell instead of stripping it", () => {
    const html =
        '<table><tr><th>A</th><th>B</th></tr>' +
        '<tr><td><b>Bold</b> cell</td><td><a href="https://example.com">Link</a> cell</td></tr></table>';
    const result = htmlToRichMarkdown(html);
    assert.match(result, /\*\*Bold\*\* cell/);
    assert.match(result, /\[Link\]\(https:\/\/example\.com\) cell/);
});

test("promotes a substantial standalone raster image to a real media block", () => {
    const html = '<p>Check this out:</p><img src="https://example.com/banner.png" width="600" height="300" alt="Summer Sale">';
    const result = htmlToRichMarkdown(html);
    assert.match(result, /!\[\]\(https:\/\/example\.com\/banner\.png "Summer Sale"\)/);
});

test("promotes a raster image even with a query string after the extension", () => {
    const html = '<img src="https://example.com/photo.jpg?w=600" width="600" height="300" alt="Photo">';
    const result = htmlToRichMarkdown(html);
    assert.match(result, /!\[\]\(https:\/\/example\.com\/photo\.jpg\?w=600 "Photo"\)/);
});

// Regression test: Telegram's photo pipeline does not accept SVG. In
// production, a placehold.co URL (Content-Type: image/svg+xml) sent as a
// media block failed with RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND. Any URL that
// doesn't visibly end in a known raster extension — including SVG and
// extension-less/query-string-only URLs we can't verify — falls back to
// alt text instead of risking the same failure.
test("does not emit a media block for an SVG image", () => {
    const html = '<img src="https://placehold.co/600x300?text=Summer+Sale" width="600" height="300" alt="Up to 40% Off Summer Sale">';
    const result = htmlToRichMarkdown(html);
    assert.doesNotMatch(result, /!\[\]/);
    assert.match(result, /Up to 40% Off Summer Sale/);
});

test("does not emit a media block for an extension-less/query-string-only image URL", () => {
    const html = '<img src="https://example.com/image?id=123" width="600" height="300" alt="Mystery image">';
    const result = htmlToRichMarkdown(html);
    assert.doesNotMatch(result, /!\[\]/);
    assert.match(result, /Mystery image/);
});

test("keeps an image inside a link as the link label", () => {
    const html = '<a href="https://shop.example.com"><img src="https://example.com/banner.png" width="600" height="300" alt="Shop Now"></a>';
    const result = htmlToRichMarkdown(html);
    assert.equal(result, "[Shop Now](https://shop.example.com)");
    assert.doesNotMatch(result, /!\[\]/);
});

test("keeps a small icon image as alt text instead of a media block", () => {
    const html = '<img src="https://example.com/icon.png" width="24" height="24" alt="Discount Icon">';
    const result = htmlToRichMarkdown(html);
    assert.equal(result, "Discount Icon");
    assert.doesNotMatch(result, /!\[\]/);
});

test("keeps an image inside a data table cell as alt text", () => {
    const html =
        '<table><tr><th>Item</th><th>Photo</th></tr>' +
        '<tr><td>Umbrella</td><td><img src="https://example.com/u.jpg" width="200" height="200" alt="Umbrella Photo"></td></tr></table>';
    const result = htmlToRichMarkdown(html);
    assert.match(result, /\| Umbrella \| Umbrella Photo \|/);
    assert.doesNotMatch(result, /!\[\]/);
});
