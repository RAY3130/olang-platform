'use strict';

/**
 * One-shot refactor of public/assets/main.css:
 *  - drops every rule that belonged to the retired 3D viewer, its room scene and the media tabs;
 *  - drops rules for components that no longer exist in the templates;
 *  - appends the image aspect-ratio contract used by the product card and the product page.
 *
 * Run with: node scripts/refactor-css-ratio-contract.js [--dry]
 */

const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.resolve(__dirname, '..', 'public', 'assets', 'main.css');

const FORBIDDEN_SELECTOR = new RegExp(
  '(^|[^a-z0-9_-])(' + [
    'section-3d',
    'section-head-3d',
    'viewer-[a-z0-9_-]*',
    'model-disclaimer',
    'section-legacyRooms',
    'legacyRoom[a-z0-9_-]*',
    '[a-z0-9_-]*-legacyRoom[a-z0-9_-]*',
    'badge-3d',
    'embedded-viewer',
    'media-tabs?',
    'media-pane[a-z0-9_-]*',
    'detail-rail',
    'detail-card[a-z0-9_-]*',
    'detail-close',
    'detail-readout',
    'dimension-install',
    'dimension-label',
    'photo-stage',
    'media-entry[a-z0-9_-]*',
    'product-finish-gallery',
    'product-finish-photo',
    'product-finish-list',
  ].join('|') + ')(?=$|[^a-z0-9_-])',
  'i',
);

function splitRules(css) {
  // Returns [{ prelude, body, at }] where `at` is the at-rule name for nested blocks.
  const out = [];
  let i = 0;
  let depth = 0;
  let start = 0;
  let preludeStart = 0;
  let mode = 'top';
  const stack = [];
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (mode === 'top') {
      if (ch === '{') {
        const prelude = css.slice(preludeStart, i);
        const trimmed = prelude.trim().replace(/^\/\*[\s\S]*?\*\//, '').trim();
        const name = trimmed.startsWith('@') ? trimmed.split(/[\s({]/)[0].toLowerCase().replace(/^@/, '') : null;
        stack.push({ prelude, start, bodyStart: i + 1, name });
        depth += 1;
        mode = 'block';
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const frame = stack.pop();
          out.push({ prelude: frame.prelude, body: css.slice(frame.bodyStart, i), start: frame.start, end: i + 1, name: frame.name });
          preludeStart = i + 1;
          mode = 'top';
        }
      } else if (ch === ';' && css.slice(preludeStart, i).trim().startsWith('@')) {
        out.push({ prelude: css.slice(preludeStart, i + 1), body: '', start: preludeStart, end: i + 1, name: 'statement' });
        preludeStart = i + 1;
      }
      i += 1;
      continue;
    }
    // inside a block: track nesting for nested at-rules
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const frame = stack.pop();
        out.push({ prelude: frame.prelude, body: css.slice(frame.bodyStart, i), start: frame.start, end: i + 1, name: frame.name });
        preludeStart = i + 1;
        mode = 'top';
      }
    }
    i += 1;
  }
  if (preludeStart < css.length) {
    const tail = css.slice(preludeStart);
    if (tail.trim()) out.push({ prelude: tail, body: '', start: preludeStart, end: css.length, name: 'raw' });
  }
  return out;
}

function selectorMatches(selector) {
  // Split on commas at depth 0 (no :has nesting in this file).
  return selector.split(',').some((part) => FORBIDDEN_SELECTOR.test(part.trim()));
}

function filterRules(css, stats) {
  const rules = splitRules(css);
  let result = '';
  for (const rule of rules) {
    if (rule.name === 'statement' || rule.name === 'raw') {
      result += rule.prelude;
      continue;
    }
    if (rule.name === 'media' || rule.name === 'supports') {
      const inner = filterRules(rule.body, stats);
      if (!inner.trim()) {
        stats.removedBlocks += 1;
        continue;
      }
      result += rule.prelude + '{' + inner + '}';
      continue;
    }
    if (rule.name) {
      // Other at-rules (@font-face, @keyframes, @page, @charset) are kept verbatim.
      result += rule.prelude + '{' + rule.body + '}';
      continue;
    }
    if (selectorMatches(rule.prelude)) {
      stats.removedRules += 1;
      stats.removedSelectors.push(rule.prelude.trim().replace(/\s+/g, ' ').slice(0, 120));
      continue;
    }
    result += rule.prelude + '{' + rule.body + '}';
  }
  return result;
}

const APPENDIX = `
/* --------------------------------------------------------------------------
   Image ratio contract
   Only these five boxes may be declared; a sixth ratio has to be registered here,
   in src/lib/image-ratio.js and in the build manifest rule block before use.
   -------------------------------------------------------------------------- */
.ratio-1x1 { aspect-ratio: 1 / 1; }
.ratio-4x3 { aspect-ratio: 4 / 3; }
.ratio-3x2 { aspect-ratio: 3 / 2; }
.ratio-2x1 { aspect-ratio: 2 / 1; }
.ratio-3x4 { aspect-ratio: 3 / 4; }

.product-card__media {
  position: relative;
  display: grid;
  place-items: center;
  background: #f7f4ef;
  overflow: hidden;
  padding: 1.35rem;
}
.product-card__media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: multiply;
  transition: transform .25s ease;
}
.product-card:hover .product-card__media img { transform: scale(1.035); }

/* Cards keep their own height: a 1:1 model and a 2:1 model sit on the same row with
   different heights, which is the accepted trade-off for never cropping a product. */
.product-grid { align-items: start; }

.photo-stage { position: relative; width: 100%; display: flex; flex-direction: column; gap: .55rem; }
.photo-frame {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  background: #f7f4ef;
  border: 1px solid #ded5c8;
  overflow: hidden;
}
.photo-frame picture { display: contents; }
.photo-frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #f7f4ef;
  cursor: zoom-in;
}
.photo-caption { margin: 0; color: #665b4d; font-size: .62rem; letter-spacing: .02em; }
.photo-finishes-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: .35rem .55rem; margin: .15rem 0 0; font-size: .68rem; color: #4f463c; }
.photo-finishes-label { color: #746a5d; font-size: .6rem; letter-spacing: .08em; text-transform: uppercase; }
.photo-color.is-chip-only { opacity: .75; border-style: dashed; }
.photo-color img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
.photo-colors-request { flex-basis: 100%; margin: .15rem 0 0; font-size: .66rem; }
.photo-colors-note { flex-basis: 100%; margin: 0 0 .2rem; font-size: .6rem; color: #746a5d; }

@media (max-width: 900px) {
  .photo-frame { aspect-ratio: auto !important; }
  .photo-frame img { height: auto; max-height: 420px; }
}
`;

function main() {
  const original = fs.readFileSync(CSS_PATH, 'utf8');
  const stats = { removedRules: 0, removedBlocks: 0, removedSelectors: [] };
  let output = filterRules(original, stats);
  output = output.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  // Drop the stale "3D" heading comments that survived because their rules are gone.
  output = output.replace(/\/\*\s*-*\s*\n?\s*Product 3D viewer\s*\n\s*-*\s*\*\//g, '');
  output = output.replace(/\/\*\s*3D stage\s*\*\//g, '');

  output += APPENDIX;

  console.log('removed rules:', stats.removedRules, 'removed empty/media blocks:', stats.removedBlocks);
  console.log('removed selectors:');
  for (const selector of stats.removedSelectors) console.log('  - ' + selector);
  console.log('bytes:', original.length, '->', output.length);

  if (!process.argv.includes('--dry')) {
    fs.writeFileSync(CSS_PATH, output, 'utf8');
    console.log('written: ' + CSS_PATH);
  }
}

main();
