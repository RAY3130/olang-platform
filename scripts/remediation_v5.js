'use strict';

/**
 * Remove the retired `threeD` namespace from the three locale dictionaries.
 *
 * The keys existed only for the interactive viewer. Leaving them in place would keep the
 * vocabulary of a feature that no longer ships, and the release check greps the source tree
 * for exactly that vocabulary.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILES = ['en.js', 'de.js', 'it.js'].map((name) => path.join(__dirname, '..', 'src', 'i18n', name));

for (const file of FILES) {
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /^[ \t]*threeD: \{[\s\S]*?^[ \t]*\},\r?\n/m;
  const match = pattern.exec(source);
  if (!match) {
    console.log('no threeD block in ' + path.basename(file));
    continue;
  }
  const cleaned = source.slice(0, match.index) + source.slice(match.index + match[0].length);
  fs.writeFileSync(file, cleaned, 'utf8');
  console.log(`removed threeD block from ${path.basename(file)} (${match[0].length} chars)`);
}
