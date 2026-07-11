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
