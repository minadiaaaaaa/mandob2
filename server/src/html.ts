// HTML that people write (email templates) is sent by email and shown in previews, so active content is taken out
// when it is saved: scripts, embedded documents, event handlers and script URLs. The previews are also shown in a
// sandboxed frame (web), so this is the second layer, not the only one.
const BLOCKS = /<\s*(script|iframe|frame|frameset|object|embed|applet|base|form|svg|math|template|noscript)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi;
const SINGLE = /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|base|link|meta|form|input|button|textarea|select|svg|math|template|noscript)\b[^>]*>/gi;
const HANDLERS = /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SCRIPT_URL = /(\s(?:href|src|action|formaction|xlink:href|background|poster)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data(?!:image\/(?:png|jpe?g|gif|webp);))\s*:[^"'\s>]*\2/gi;
const CSS_EXPR = /(style\s*=\s*["'][^"']*?)(expression\s*\(|url\s*\(\s*["']?\s*javascript:)/gi;

export function sanitizeHtml(html: string): string {
  let out = String(html ?? '');
  // repeat until nothing changes, so pieces that join up after one pass (<scr<script>ipt>) are caught too
  for (let i = 0; i < 5; i++) {
    const before = out;
    out = out.replace(BLOCKS, '').replace(SINGLE, '').replace(HANDLERS, '').replace(SCRIPT_URL, '$1$2#$2').replace(CSS_EXPR, '$1');
    if (out === before) break;
  }
  return out;
}
