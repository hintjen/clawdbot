import { describe, expect, it } from "vitest";

import {
  containsMatrixMention,
  extractMatrixMentions,
  formatMatrixReply,
  markdownToMatrixHtml,
  matrixHtmlToPlaintext,
} from "./format.js";

describe("markdownToMatrixHtml", () => {
  describe("basic text formatting", () => {
    it("converts plain text to paragraph", () => {
      const result = markdownToMatrixHtml("Hello world");
      expect(result).toBe("<p>Hello world</p>");
    });

    it("converts bold text", () => {
      const result = markdownToMatrixHtml("**bold text**");
      expect(result).toBe("<p><strong>bold text</strong></p>");
    });

    it("converts italic text", () => {
      const result = markdownToMatrixHtml("*italic text*");
      expect(result).toBe("<p><em>italic text</em></p>");
    });

    it("converts strikethrough text", () => {
      const result = markdownToMatrixHtml("~~strikethrough~~");
      expect(result).toBe("<p><del>strikethrough</del></p>");
    });

    it("converts inline code", () => {
      const result = markdownToMatrixHtml("`code`");
      expect(result).toBe("<p><code>code</code></p>");
    });

    it("handles mixed formatting", () => {
      const result = markdownToMatrixHtml("**bold** and *italic* and `code`");
      expect(result).toBe(
        "<p><strong>bold</strong> and <em>italic</em> and <code>code</code></p>"
      );
    });
  });

  describe("headings", () => {
    it("converts h1", () => {
      const result = markdownToMatrixHtml("# Heading 1");
      expect(result).toBe("<h1>Heading 1</h1>");
    });

    it("converts h2", () => {
      const result = markdownToMatrixHtml("## Heading 2");
      expect(result).toBe("<h2>Heading 2</h2>");
    });

    it("converts h3", () => {
      const result = markdownToMatrixHtml("### Heading 3");
      expect(result).toBe("<h3>Heading 3</h3>");
    });

    it("converts h4", () => {
      const result = markdownToMatrixHtml("#### Heading 4");
      expect(result).toBe("<h4>Heading 4</h4>");
    });

    it("converts h5", () => {
      const result = markdownToMatrixHtml("##### Heading 5");
      expect(result).toBe("<h5>Heading 5</h5>");
    });

    it("converts h6", () => {
      const result = markdownToMatrixHtml("###### Heading 6");
      expect(result).toBe("<h6>Heading 6</h6>");
    });
  });

  describe("lists", () => {
    it("converts bullet lists", () => {
      const result = markdownToMatrixHtml("- item 1\n- item 2\n- item 3");
      // markdown-it wraps list item contents in <p> tags
      expect(result).toBe(
        "<ul>\n<li><p>item 1</p>\n</li>\n<li><p>item 2</p>\n</li>\n<li><p>item 3</p>\n</li>\n</ul>"
      );
    });

    it("converts ordered lists", () => {
      const result = markdownToMatrixHtml("1. first\n2. second\n3. third");
      expect(result).toBe(
        "<ol>\n<li><p>first</p>\n</li>\n<li><p>second</p>\n</li>\n<li><p>third</p>\n</li>\n</ol>"
      );
    });

    it("converts ordered list with custom start", () => {
      const result = markdownToMatrixHtml("5. fifth\n6. sixth");
      expect(result).toBe(
        '<ol start="5">\n<li><p>fifth</p>\n</li>\n<li><p>sixth</p>\n</li>\n</ol>'
      );
    });
  });

  describe("code blocks", () => {
    it("converts fenced code block without language", () => {
      const result = markdownToMatrixHtml("```\ncode here\n```");
      expect(result).toBe("<pre><code>code here\n</code></pre>");
    });

    it("converts fenced code block with language", () => {
      const result = markdownToMatrixHtml("```typescript\nconst x = 1;\n```");
      expect(result).toBe(
        '<pre><code class="language-typescript">const x = 1;\n</code></pre>'
      );
    });

    it("escapes HTML in code blocks", () => {
      const result = markdownToMatrixHtml("```\n<script>alert('xss')</script>\n```");
      expect(result).toBe(
        "<pre><code>&lt;script&gt;alert('xss')&lt;/script&gt;\n</code></pre>"
      );
    });
  });

  describe("blockquotes", () => {
    it("converts single line blockquote", () => {
      const result = markdownToMatrixHtml("> quoted text");
      // Custom renderer puts content directly after opening tag
      expect(result).toBe("<blockquote><p>quoted text</p>\n</blockquote>");
    });

    it("converts multi-line blockquote", () => {
      const result = markdownToMatrixHtml("> line 1\n> line 2");
      expect(result).toBe("<blockquote><p>line 1\nline 2</p>\n</blockquote>");
    });
  });

  describe("links", () => {
    it("converts markdown links", () => {
      const result = markdownToMatrixHtml("[link text](https://example.com)");
      expect(result).toBe('<p><a href="https://example.com">link text</a></p>');
    });

    it("auto-links URLs with linkify enabled", () => {
      const result = markdownToMatrixHtml("Check out https://example.com for more");
      expect(result).toBe(
        '<p>Check out <a href="https://example.com">https://example.com</a> for more</p>'
      );
    });

    it("escapes HTML in link URLs", () => {
      const result = markdownToMatrixHtml('[link](https://example.com/path?a=1&b=2)');
      expect(result).toBe(
        '<p><a href="https://example.com/path?a=1&amp;b=2">link</a></p>'
      );
    });
  });

  describe("horizontal rule", () => {
    it("converts horizontal rule", () => {
      const result = markdownToMatrixHtml("above\n\n---\n\nbelow");
      expect(result).toBe("<p>above</p>\n<hr>\n<p>below</p>");
    });
  });

  describe("HTML escaping", () => {
    it("escapes HTML in text", () => {
      const result = markdownToMatrixHtml("Use <div> tags");
      expect(result).toBe("<p>Use &lt;div&gt; tags</p>");
    });

    it("escapes special characters", () => {
      const result = markdownToMatrixHtml("A & B > C < D");
      expect(result).toBe("<p>A &amp; B &gt; C &lt; D</p>");
    });
  });

  describe("images", () => {
    it("renders image alt text only (Matrix does not support inline images)", () => {
      const result = markdownToMatrixHtml("![alt text](https://example.com/image.png)");
      expect(result).toBe("<p>alt text</p>");
    });
  });

  describe("tables", () => {
    it("converts simple table", () => {
      const md = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;
      const result = markdownToMatrixHtml(md);
      expect(result).toContain("<table>");
      expect(result).toContain("<thead>");
      expect(result).toContain("<th>Header 1</th>");
      expect(result).toContain("<th>Header 2</th>");
      expect(result).toContain("<tbody>");
      expect(result).toContain("<td>Cell 1</td>");
      expect(result).toContain("<td>Cell 2</td>");
      expect(result).toContain("</table>");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = markdownToMatrixHtml("");
      expect(result).toBe("");
    });

    it("handles null/undefined gracefully", () => {
      const result = markdownToMatrixHtml(null as unknown as string);
      expect(result).toBe("");
    });

    it("trims result and collapses excess newlines", () => {
      const result = markdownToMatrixHtml("para1\n\n\n\npara2");
      expect(result).not.toContain("\n\n\n");
    });
  });
});

describe("matrixHtmlToPlaintext", () => {
  describe("basic stripping", () => {
    it("strips paragraph tags", () => {
      const result = matrixHtmlToPlaintext("<p>Hello world</p>");
      expect(result).toBe("Hello world");
    });

    it("strips formatting tags", () => {
      const result = matrixHtmlToPlaintext(
        "<p><strong>bold</strong> and <em>italic</em></p>"
      );
      expect(result).toBe("bold and italic");
    });

    it("preserves link text", () => {
      const result = matrixHtmlToPlaintext(
        '<p><a href="https://example.com">link text</a></p>'
      );
      expect(result).toBe("link text");
    });
  });

  describe("block elements to newlines", () => {
    it("converts br to newline", () => {
      const result = matrixHtmlToPlaintext("<p>line 1<br>line 2</p>");
      expect(result).toBe("line 1\nline 2");
    });

    it("converts paragraph close to double newline", () => {
      const result = matrixHtmlToPlaintext("<p>para 1</p><p>para 2</p>");
      expect(result).toBe("para 1\n\npara 2");
    });

    it("converts heading close to double newline", () => {
      const result = matrixHtmlToPlaintext("<h1>Title</h1><p>Content</p>");
      expect(result).toBe("Title\n\nContent");
    });

    it("converts list item close to newline", () => {
      const result = matrixHtmlToPlaintext(
        "<ul><li>item 1</li><li>item 2</li></ul>"
      );
      expect(result).toBe("item 1\nitem 2");
    });

    it("converts hr to separator", () => {
      const result = matrixHtmlToPlaintext("<p>above</p><hr><p>below</p>");
      // </p> adds \n\n, <hr> adds \n---\n, then collapsed
      expect(result).toBe("above\n\n---\nbelow");
    });
  });

  describe("HTML entity decoding", () => {
    it("decodes &lt; and &gt;", () => {
      const result = matrixHtmlToPlaintext("<p>&lt;script&gt;</p>");
      expect(result).toBe("<script>");
    });

    it("decodes &amp;", () => {
      const result = matrixHtmlToPlaintext("<p>A &amp; B</p>");
      expect(result).toBe("A & B");
    });

    it("decodes &quot;", () => {
      const result = matrixHtmlToPlaintext("<p>Say &quot;hello&quot;</p>");
      expect(result).toBe('Say "hello"');
    });

    it("decodes &#39;", () => {
      const result = matrixHtmlToPlaintext("<p>It&#39;s fine</p>");
      expect(result).toBe("It's fine");
    });

    it("decodes &nbsp;", () => {
      const result = matrixHtmlToPlaintext("<p>non&nbsp;breaking</p>");
      expect(result).toBe("non breaking");
    });
  });

  describe("whitespace handling", () => {
    it("collapses multiple newlines", () => {
      const result = matrixHtmlToPlaintext("<p>a</p><p></p><p>b</p>");
      expect(result).not.toContain("\n\n\n");
    });

    it("trims leading and trailing whitespace", () => {
      const result = matrixHtmlToPlaintext("  <p>content</p>  ");
      expect(result).toBe("content");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = matrixHtmlToPlaintext("");
      expect(result).toBe("");
    });

    it("handles null/undefined gracefully", () => {
      const result = matrixHtmlToPlaintext(null as unknown as string);
      expect(result).toBe("");
    });

    it("returns empty for whitespace only", () => {
      const result = matrixHtmlToPlaintext("   ");
      expect(result).toBe("");
    });
  });
});

describe("formatMatrixReply", () => {
  it("formats plain text reply", () => {
    const result = formatMatrixReply({
      originalSender: "@alice:matrix.org",
      originalBody: "Original message",
      originalEventId: "$event123",
      newBody: "My reply",
    });

    // Plain text body should have quote format
    expect(result.body).toContain("> <@alice:matrix.org>");
    expect(result.body).toContain("Original message");
    expect(result.body).toContain("My reply");

    // Formatted body should have mx-reply wrapper
    expect(result.formattedBody).toContain("<mx-reply>");
    expect(result.formattedBody).toContain("<blockquote>");
    expect(result.formattedBody).toContain("@alice:matrix.org");
    expect(result.formattedBody).toContain("Original message");
    expect(result.formattedBody).toContain("</mx-reply>");
  });

  it("includes matrix.to links in formatted body", () => {
    const result = formatMatrixReply({
      originalSender: "@bob:example.org",
      originalBody: "Hello",
      originalEventId: "$event456",
      newBody: "Hi back",
    });

    expect(result.formattedBody).toContain("https://matrix.to/#/@bob:example.org");
  });

  it("converts markdown in new body to HTML", () => {
    const result = formatMatrixReply({
      originalSender: "@user:matrix.org",
      originalBody: "Original",
      originalEventId: "$event789",
      newBody: "**bold** reply",
    });

    expect(result.formattedBody).toContain("<strong>bold</strong>");
  });

  it("handles multiline original message", () => {
    const result = formatMatrixReply({
      originalSender: "@user:matrix.org",
      originalBody: "Line 1\nLine 2\nLine 3",
      originalEventId: "$event",
      newBody: "Reply",
    });

    // Plain body should have all lines quoted
    expect(result.body).toContain("> Line 1");
    expect(result.body).toContain("> Line 2");
    expect(result.body).toContain("> Line 3");
  });

  it("escapes HTML in original body", () => {
    const result = formatMatrixReply({
      originalSender: "@user:matrix.org",
      originalBody: "<script>alert('xss')</script>",
      originalEventId: "$event",
      newBody: "Safe reply",
    });

    expect(result.formattedBody).toContain("&lt;script&gt;");
    expect(result.formattedBody).not.toContain("<script>alert");
  });

  it("escapes HTML in sender ID", () => {
    const result = formatMatrixReply({
      originalSender: "@user<test>:matrix.org",
      originalBody: "Original",
      originalEventId: "$event",
      newBody: "Reply",
    });

    expect(result.formattedBody).toContain("@user&lt;test&gt;:matrix.org");
  });
});

describe("extractMatrixMentions", () => {
  it("extracts single mention", () => {
    const result = extractMatrixMentions("Hello @alice:matrix.org!");
    expect(result).toEqual(["@alice:matrix.org"]);
  });

  it("extracts multiple mentions", () => {
    const result = extractMatrixMentions(
      "@alice:matrix.org and @bob:example.org were here"
    );
    expect(result).toContain("@alice:matrix.org");
    expect(result).toContain("@bob:example.org");
    expect(result).toHaveLength(2);
  });

  it("deduplicates repeated mentions", () => {
    const result = extractMatrixMentions(
      "@alice:matrix.org said hi to @alice:matrix.org"
    );
    expect(result).toEqual(["@alice:matrix.org"]);
  });

  it("returns empty array for no mentions", () => {
    const result = extractMatrixMentions("No mentions here");
    expect(result).toEqual([]);
  });

  it("handles various valid user ID formats", () => {
    const result = extractMatrixMentions(
      "@user_name:server.com @user.name:sub.domain.org @user-name:matrix.org @user=name:example.com"
    );
    expect(result).toContain("@user_name:server.com");
    expect(result).toContain("@user.name:sub.domain.org");
    expect(result).toContain("@user-name:matrix.org");
    expect(result).toContain("@user=name:example.com");
  });

  it("handles user IDs with numbers", () => {
    const result = extractMatrixMentions("@user123:matrix.org");
    expect(result).toEqual(["@user123:matrix.org"]);
  });

  it("handles empty string", () => {
    const result = extractMatrixMentions("");
    expect(result).toEqual([]);
  });
});

describe("containsMatrixMention", () => {
  it("returns true when userId is mentioned", () => {
    const result = containsMatrixMention(
      "Hey @alice:matrix.org how are you?",
      "@alice:matrix.org"
    );
    expect(result).toBe(true);
  });

  it("returns false when userId is not mentioned", () => {
    const result = containsMatrixMention(
      "Hey @bob:matrix.org how are you?",
      "@alice:matrix.org"
    );
    expect(result).toBe(false);
  });

  it("handles partial matches correctly", () => {
    // Should not match partial user IDs
    const result = containsMatrixMention("@alice:matrix", "@alice:matrix.org");
    expect(result).toBe(false);
  });

  it("handles empty body", () => {
    const result = containsMatrixMention("", "@alice:matrix.org");
    expect(result).toBe(false);
  });

  it("handles multiple occurrences", () => {
    const result = containsMatrixMention(
      "@alice:matrix.org and @alice:matrix.org again",
      "@alice:matrix.org"
    );
    expect(result).toBe(true);
  });

  it("is case sensitive", () => {
    const result = containsMatrixMention(
      "@Alice:matrix.org",
      "@alice:matrix.org"
    );
    expect(result).toBe(false);
  });
});
