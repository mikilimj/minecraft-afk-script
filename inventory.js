function snapshotInventory(bot) {
  if (!bot || !bot.inventory || !Array.isArray(bot.inventory.slots)) return [];
  return bot.inventory.slots.map((item, slot) =>
    item ? { slot, name: item.name, displayName: item.displayName, count: item.count } : null
  );
}

module.exports = { snapshotInventory };
