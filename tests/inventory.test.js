const { snapshotInventory } = require('../inventory');

test('returns [] when bot has no inventory', () => {
  expect(snapshotInventory(null)).toEqual([]);
  expect(snapshotInventory({})).toEqual([]);
});

test('maps slots, preserving index and nulls', () => {
  const bot = { inventory: { slots: [
    null,
    { name: 'dirt', displayName: 'Dirt', count: 64 },
    null,
    { name: 'stone', displayName: 'Stone', count: 12 },
  ] } };
  expect(snapshotInventory(bot)).toEqual([
    null,
    { slot: 1, name: 'dirt', displayName: 'Dirt', count: 64 },
    null,
    { slot: 3, name: 'stone', displayName: 'Stone', count: 12 },
  ]);
});
