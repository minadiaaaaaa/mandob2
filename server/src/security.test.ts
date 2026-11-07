// The protections added after the security review (SECURITY-REPORT.md): HTML written by staff loses its active
// content (finding 1), CSV cells cannot become formulas (finding 5), and uploads must be what their bytes say (finding 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from './html.js';
import { csvSafe } from './http.js';
import { checkFileType, sniffMime } from './files.js';

test('email template HTML keeps its layout and loses scripts, handlers and script URLs', () => {
  const keep = '<table style="width:100%"><tr><td><p>Hello {owner_name}</p><a href="https://example.com/x">link</a><img src="cid:logo" alt="logo"></td></tr></table>';
  assert.equal(sanitizeHtml(keep), keep);
  const attacks = [
    '<p>hi</p><script>fetch("/api/me")</script>',
    '<img src=x onerror="fetch(\'/api/me\')">',
    '<a href="javascript:alert(1)">x</a>',
    '<a href=" JaVaScRiPt:alert(1)">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload=alert(1)><circle/></svg>',
    '<scr<script>ipt>alert(1)</script>',
    '<body onload=alert(1)>',
    '<object data="x.swf"></object><embed src="x">',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/">',
  ];
  for (const a of attacks) {
    const out = sanitizeHtml(a).toLowerCase();
    assert.ok(!/<script|<iframe|<svg|<object|<embed|<meta|<base|\son\w+\s*=|javascript:|data:text/.test(out), `${a} → ${out}`);
  }
  assert.match(sanitizeHtml('<img src="data:image/png;base64,AAAA">'), /data:image\/png/, 'inline images stay');
});

test('CSV cells that start like a formula are made plain text; numbers stay numbers', () => {
  assert.equal(csvSafe('=HYPERLINK("http://example.invalid/","open")'), `'=HYPERLINK("http://example.invalid/","open")`);
  for (const s of ['+1+2', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) assert.equal(csvSafe(s)[0], "'", s);
  assert.equal(csvSafe(-5), '-5');
  assert.equal(csvSafe('-5'), '-5');
  assert.equal(csvSafe('-12.50'), '-12.50');
  assert.equal(csvSafe('Ahmed'), 'Ahmed');
  assert.equal(csvSafe('0500000000'), '0500000000');
});

test('an upload must be what its first bytes say', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const pdf = Buffer.from('%PDF-1.7\n...');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const gif = Buffer.from('GIF89a....');
  assert.equal(sniffMime(png), 'image/png');
  assert.equal(sniffMime(jpg), 'image/jpeg');
  assert.equal(sniffMime(pdf), 'application/pdf');
  assert.equal(sniffMime(webp), 'image/webp');
  assert.equal(sniffMime(gif), 'image/gif');
  assert.equal(sniffMime(Buffer.from('<html><script>alert(1)</script>')), null);
  assert.doesNotThrow(() => checkFileType({ buffer: pdf, mimetype: 'application/pdf' }));
  assert.throws(() => checkFileType({ buffer: Buffer.from('<html>'), mimetype: 'application/pdf' }), /file_type_not_allowed/, 'an HTML file sent as a PDF');
  assert.throws(() => checkFileType({ buffer: png, mimetype: 'application/pdf' }), /file_type_not_allowed/, 'a PNG sent as a PDF');
  assert.throws(() => checkFileType({ buffer: pdf, mimetype: 'text/html' }), /file_type_not_allowed/, 'a type that is not allowed');
});
