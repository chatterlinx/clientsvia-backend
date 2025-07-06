const fs = require('fs');
const path = require('path');

describe('stripMarkdown export', () => {
  test('utils/textUtils exports stripMarkdown', () => {
    const { stripMarkdown } = require('../utils/textUtils');
    expect(typeof stripMarkdown).toBe('function');
  });
});

describe('no duplicate stripMarkdown implementations', () => {
  test('stripMarkdown function only exists in utils/textUtils.js', () => {
    const searchDir = path.resolve(__dirname, '..');
    const files = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          files.push(full);
        }
      }
    }
    walk(searchDir);
    const matches = [];
    for (const file of files) {
      if (file.endsWith(path.join('utils', 'textUtils.js'))) continue;
      const contents = fs.readFileSync(file, 'utf8');
      const regex = /function\s+stripMarkdown\s*\(/;
      if (regex.test(contents)) {
        matches.push(file);
      }
    }
    expect(matches).toEqual([]);
  });
});
