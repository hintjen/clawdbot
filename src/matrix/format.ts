import MarkdownIt from "markdown-it";

type ListState = {
  type: "bullet" | "ordered";
  index: number;
};

type RenderEnv = {
  matrixListStack?: ListState[];
  matrixLinkStack?: boolean[];
};

/**
 * Matrix HTML uses a specific subset of HTML tags:
 * - Text: <em>, <strong>, <del>/<s>, <code>
 * - Blocks: <p>, <pre>, <blockquote>, <ol>, <ul>, <li>
 * - Headings: <h1>-<h6>
 * - Links: <a href="...">
 * - Line breaks: <br>
 * - Tables: <table>, <thead>, <tbody>, <tr>, <th>, <td>
 * - Horizontal rule: <hr>
 *
 * Reference: https://spec.matrix.org/latest/client-server-api/#mroommessage-msgtypes
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

md.enable("strikethrough");

const { escapeHtml } = md.utils;

function getListStack(env: RenderEnv): ListState[] {
  if (!env.matrixListStack) env.matrixListStack = [];
  return env.matrixListStack;
}

function getLinkStack(env: RenderEnv): boolean[] {
  if (!env.matrixLinkStack) env.matrixLinkStack = [];
  return env.matrixLinkStack;
}

md.renderer.rules.text = (tokens, idx) =>
  escapeHtml(tokens[idx]?.content ?? "");

md.renderer.rules.softbreak = () => "\n";
md.renderer.rules.hardbreak = () => "<br>\n";

md.renderer.rules.paragraph_open = () => "<p>";
md.renderer.rules.paragraph_close = () => "</p>\n";

md.renderer.rules.heading_open = (tokens, idx) => {
  const tag = tokens[idx]?.tag ?? "h1";
  return `<${tag}>`;
};
md.renderer.rules.heading_close = (tokens, idx) => {
  const tag = tokens[idx]?.tag ?? "h1";
  return `</${tag}>\n`;
};

md.renderer.rules.blockquote_open = () => "<blockquote>";
md.renderer.rules.blockquote_close = () => "</blockquote>\n";

md.renderer.rules.bullet_list_open = (_tokens, _idx, _opts, env) => {
  getListStack(env as RenderEnv).push({ type: "bullet", index: 0 });
  return "<ul>\n";
};
md.renderer.rules.bullet_list_close = (_tokens, _idx, _opts, env) => {
  getListStack(env as RenderEnv).pop();
  return "</ul>\n";
};
md.renderer.rules.ordered_list_open = (tokens, idx, _opts, env) => {
  const start = Number(tokens[idx]?.attrGet("start") ?? "1");
  getListStack(env as RenderEnv).push({ type: "ordered", index: start - 1 });
  const startAttr = start !== 1 ? ` start="${start}"` : "";
  return `<ol${startAttr}>\n`;
};
md.renderer.rules.ordered_list_close = (_tokens, _idx, _opts, env) => {
  getListStack(env as RenderEnv).pop();
  return "</ol>\n";
};
md.renderer.rules.list_item_open = () => "<li>";
md.renderer.rules.list_item_close = () => "</li>\n";

md.renderer.rules.em_open = () => "<em>";
md.renderer.rules.em_close = () => "</em>";
md.renderer.rules.strong_open = () => "<strong>";
md.renderer.rules.strong_close = () => "</strong>";
md.renderer.rules.s_open = () => "<del>";
md.renderer.rules.s_close = () => "</del>";

md.renderer.rules.code_inline = (tokens, idx) =>
  `<code>${escapeHtml(tokens[idx]?.content ?? "")}</code>`;
md.renderer.rules.code_block = (tokens, idx) =>
  `<pre><code>${escapeHtml(tokens[idx]?.content ?? "")}</code></pre>\n`;
md.renderer.rules.fence = (tokens, idx) => {
  const info = tokens[idx]?.info ?? "";
  const langClass = info ? ` class="language-${escapeHtml(info)}"` : "";
  return `<pre><code${langClass}>${escapeHtml(tokens[idx]?.content ?? "")}</code></pre>\n`;
};

md.renderer.rules.link_open = (tokens, idx, _opts, env) => {
  const href = tokens[idx]?.attrGet("href") ?? "";
  const safeHref = escapeHtml(href);
  const stack = getLinkStack(env as RenderEnv);
  const hasHref = Boolean(safeHref);
  stack.push(hasHref);
  return hasHref ? `<a href="${safeHref}">` : "";
};
md.renderer.rules.link_close = (_tokens, _idx, _opts, env) => {
  const stack = getLinkStack(env as RenderEnv);
  const hasHref = stack.pop();
  return hasHref ? "</a>" : "";
};

md.renderer.rules.image = (tokens, idx) => {
  // Matrix doesn't have inline images in HTML, just show alt text
  const alt = tokens[idx]?.content ?? "";
  return escapeHtml(alt);
};

md.renderer.rules.html_block = (tokens, idx) =>
  escapeHtml(tokens[idx]?.content ?? "");
md.renderer.rules.html_inline = (tokens, idx) =>
  escapeHtml(tokens[idx]?.content ?? "");

md.renderer.rules.table_open = () => "<table>\n";
md.renderer.rules.table_close = () => "</table>\n";
md.renderer.rules.thead_open = () => "<thead>\n";
md.renderer.rules.thead_close = () => "</thead>\n";
md.renderer.rules.tbody_open = () => "<tbody>\n";
md.renderer.rules.tbody_close = () => "</tbody>\n";
md.renderer.rules.tr_open = () => "<tr>\n";
md.renderer.rules.tr_close = () => "</tr>\n";
md.renderer.rules.th_open = () => "<th>";
md.renderer.rules.th_close = () => "</th>\n";
md.renderer.rules.td_open = () => "<td>";
md.renderer.rules.td_close = () => "</td>\n";

md.renderer.rules.hr = () => "<hr>\n";

/**
 * Convert markdown to Matrix-compatible HTML.
 * Uses the Matrix-flavored HTML subset.
 */
export function markdownToMatrixHtml(markdown: string): string {
  const env: RenderEnv = {};
  const rendered = md.render(markdown ?? "", env);
  return rendered
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Strip HTML tags to get plain text body.
 * Matrix messages require both plain and formatted body.
 */
export function matrixHtmlToPlaintext(html: string): string {
  if (!html) return "";

  return (
    html
      // Replace <br> and block-level tags with newlines
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<\/blockquote>/gi, "\n")
      .replace(/<\/pre>/gi, "\n\n")
      .replace(/<hr\s*\/?>/gi, "\n---\n")
      // Strip remaining HTML tags
      .replace(/<[^>]+>/g, "")
      // Decode HTML entities
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Clean up extra whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Format a reply with quote block.
 * Matrix reply format includes a fallback for clients that don't support rich replies.
 */
export function formatMatrixReply(params: {
  originalSender: string;
  originalBody: string;
  originalEventId: string;
  newBody: string;
}): { body: string; formattedBody: string } {
  const { originalSender, originalBody, originalEventId, newBody } = params;

  // Plain text fallback format (for clients that don't support rich replies)
  // The > prefix indicates quoted text
  const quotedLines = originalBody
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const plainBody = `> <${originalSender}> ${quotedLines.replace(/^> /, "")}\n\n${newBody}`;

  // HTML format with mx-reply wrapper for rich reply support
  const escapedOriginal = escapeHtml(originalBody);
  const escapedNew = markdownToMatrixHtml(newBody);
  const formattedBody = `<mx-reply><blockquote><a href="https://matrix.to/#/${escapeHtml(originalSender)}/${escapeHtml(originalEventId)}">In reply to</a> <a href="https://matrix.to/#/${escapeHtml(originalSender)}">${escapeHtml(originalSender)}</a><br>${escapedOriginal}</blockquote></mx-reply>${escapedNew}`;

  return { body: plainBody, formattedBody };
}

/**
 * Extract mention-style user IDs from message body.
 * Matrix user IDs are in the format @user:server.com
 */
export function extractMatrixMentions(body: string): string[] {
  const mentionPattern = /@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+/g;
  return [...new Set(body.match(mentionPattern) ?? [])];
}

/**
 * Check if a message body mentions a specific user ID.
 */
export function containsMatrixMention(body: string, userId: string): boolean {
  return body.includes(userId);
}
