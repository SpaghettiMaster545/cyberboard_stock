/**
 * Compare the previous and current normalized states and return a list of changes.
 * Change types: 'new', 'restock', 'soldout', 'price', 'removed'.
 */
export function diffStates(oldState, newState) {
  const changes = [];
  const oldV = (oldState && oldState.variants) || {};
  const newV = (newState && newState.variants) || {};

  for (const [id, nv] of Object.entries(newV)) {
    const ov = oldV[id];
    if (!ov) {
      changes.push({ type: 'new', id, variant: nv });
      continue;
    }
    if (!ov.available && nv.available) {
      changes.push({ type: 'restock', id, variant: nv });
    } else if (ov.available && !nv.available) {
      changes.push({ type: 'soldout', id, variant: nv });
    }
    if (ov.price !== nv.price && ov.price != null && nv.price != null) {
      changes.push({ type: 'price', id, variant: nv, oldPrice: ov.price });
    }
  }

  for (const [id, ov] of Object.entries(oldV)) {
    if (!newV[id]) changes.push({ type: 'removed', id, variant: ov });
  }

  return changes;
}
