function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const ICON = {
  restock: '\u{1F7E2}', // green circle
  soldout: '\u{1F534}', // red circle
  new: '\u{1F195}', // NEW button
  price: '\u{1F4B0}', // money bag
  removed: '\u26AA' // white circle
};

const LABEL = {
  restock: 'BACK IN STOCK',
  soldout: 'Sold out',
  new: 'New listing',
  price: 'Price change',
  removed: 'Removed'
};

export function formatChange(ch) {
  const v = ch.variant;
  const name = esc(v.productTitle);
  const variant =
    v.variantTitle && v.variantTitle !== 'Default Title'
      ? ` \u2014 ${esc(v.variantTitle)}`
      : '';
  const price = v.price ? ` ($${esc(v.price)})` : '';

  let line = `${ICON[ch.type]} <b>${LABEL[ch.type]}</b>\n${name}${variant}${price}`;
  if (ch.type === 'price') line += `\n<i>was $${esc(ch.oldPrice)}</i>`;
  line += `\n<a href="${esc(v.url)}">View product</a>`;
  return line;
}

/**
 * Turn a list of changes into one or more Telegram messages, each safely under
 * Telegram's 4096-character limit.
 */
export function formatBatch(changes) {
  const blocks = changes.map(formatChange);
  const messages = [];
  let cur = '';
  for (const b of blocks) {
    const candidate = cur ? `${cur}\n\n${b}` : b;
    if (candidate.length > 3800) {
      if (cur) messages.push(cur);
      cur = b;
    } else {
      cur = candidate;
    }
  }
  if (cur) messages.push(cur);
  return messages;
}
