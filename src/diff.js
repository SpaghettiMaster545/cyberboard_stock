/**
 * Compare two item maps ({ [itemId]: item }) and list what changed.
 * Change types: 'new', 'restock', 'soldout', 'price', 'removed'.
 */
export function diffItems(oldItems = {}, newItems = {}) {
  const changes = [];

  for (const [id, item] of Object.entries(newItems)) {
    const before = oldItems[id];
    if (!before) {
      changes.push({ type: 'new', id, item });
      continue;
    }
    if (!before.available && item.available) {
      changes.push({ type: 'restock', id, item });
    } else if (before.available && !item.available) {
      changes.push({ type: 'soldout', id, item });
    }
    if (
      before.price != null &&
      item.price != null &&
      Math.abs(Number(before.price) - Number(item.price)) > 0.001
    ) {
      changes.push({ type: 'price', id, item, oldPrice: Number(before.price) });
    }
  }

  for (const [id, item] of Object.entries(oldItems)) {
    if (!newItems[id]) changes.push({ type: 'removed', id, item });
  }

  return changes;
}

/** Change type -> the notifyOn toggle that controls it. */
export const CHANGE_SETTING = {
  restock: 'restock',
  soldout: 'soldOut',
  new: 'newProduct',
  price: 'priceChange',
  removed: 'removed'
};

export function summarizeItems(items) {
  const list = Object.values(items || {});
  const groups = new Map();
  for (const it of list) {
    const key = it.group || it.title;
    groups.set(key, (groups.get(key) || false) || it.available);
  }
  return {
    itemCount: list.length,
    inStockCount: list.filter((i) => i.available).length,
    groupCount: groups.size,
    groupsInStock: [...groups.values()].filter(Boolean).length
  };
}
