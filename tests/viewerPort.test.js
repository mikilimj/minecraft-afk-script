const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.AFK_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-test-'));
const { allocateViewerPort } = require('../server');

test('allocates sequential free ports from base', () => {
  const m = new Map();
  expect(allocateViewerPort(m, 'a', 3100)).toBe(3100);
  expect(allocateViewerPort(m, 'b', 3100)).toBe(3101);
});

test('returns the same port for the same accountId', () => {
  const m = new Map();
  expect(allocateViewerPort(m, 'a', 3100)).toBe(3100);
  expect(allocateViewerPort(m, 'a', 3100)).toBe(3100);
});

test('reuses gaps freed by removed accounts', () => {
  const m = new Map([['a', 3100], ['c', 3102]]);
  expect(allocateViewerPort(m, 'd', 3100)).toBe(3101);
});
