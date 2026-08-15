// Rich-text helpers for Asana's html_notes / html_text fields.
//
// Asana renders ONLY a small HTML whitelist and is strict about the rest — the failure
// modes are silent (field saved EMPTY) or a 400 that blames "invalid XML". These two
// helpers absorb the whole class so callers can send ordinary HTML.

// Asana renders ONLY a small HTML whitelist (body/a/em/strong/u/s/code/pre/ol/li/
// ul/blockquote/hr/br). Anything else renders as literal escaped text in the UI.
// Workaround: map common tags onto the whitelist so formatting "just works".
// Clean/whitelisted HTML passes through unchanged. NOTE: ineffective on /stories
// comments (that endpoint escapes html_text wholesale — use plain text there).
export function sanitizeAsanaHtml(html) {
  if (typeof html !== 'string') return html;
  let s = html;
  // Asana rich-text whitelist EXCLUDES <br> (verified live 2026-06-13): line breaks
  // must be literal \n, else API 400 "XML is invalid" and the field ends up EMPTY.
  // So headings/paragraphs collapse to \n\n, and any <br> (ours or caller's) → \n.
  s = s.replace(/<h[1-6][^>]*>/gi, '<strong>').replace(/<\/h[1-6]>/gi, '</strong>\n\n');
  s = s.replace(/<\/?b>/gi, m => (m[1] === '/' ? '</strong>' : '<strong>'));
  s = s.replace(/<\/?i>/gi, m => (m[1] === '/' ? '</em>' : '<em>'));
  s = s.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<\/?(div|span)[^>]*>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Asana also REQUIRES all rich text wrapped in a single <body> root, else 400
  // "Rich text should be wrapped in <body> tag" and the field ends up empty.
  if (!/^\s*<body[\s>]/i.test(s)) s = `<body>${s}</body>`;
  return s;
}

// Literal "\n"/"\t" TWO-CHARACTER escape sequences arriving in plain-text fields are a
// recurring LLM/JSON double-escape slip (a comment renders "\n\n" mid-sentence in the
// Asana UI). No legitimate Asana note/comment contains a literal backslash-n, so convert
// centrally instead of trusting every caller to serialize correctly.
export function unescapeLiteralNewlines(s) {
  if (typeof s !== 'string' || !s.includes('\\')) return s;
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}
