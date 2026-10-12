import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, makeConfig, startFakeTelegram } from './helpers/index.js';
import { Store } from '../src/store.js';
import { createContext } from '../src/context.js';
import { Monitor } from '../src/monitor.js';
import { Notifier } from '../src/telegram/notifier.js';
import { TelegramApi } from '../src/telegram/api.js';
import { TelegramBot, parseDuration } from '../src/telegram/bot.js';

const CHAT = 111;
let tg;
let bot;
let ctx;
let monitor;
const stock = { 1727363: false, 1727366: true };

before(async () => {
  tg = await startFakeTelegram();
  const fetch = fakeFetch([
    [/GetHardwareItems/, (url) => ({
      response: {
        details: JSON.parse(new URL(url).searchParams.get('input_json')).packageid.map((id) => ({
          packageid: id,
          inventory_available: stock[id] ?? false
        }))
      }
    })],
    [/packagedetails\?packageids=(\d+)/, (url) => {
      const id = url.match(/packageids=(\d+)/)[1];
      const names = { 1727363: 'Steam Frame Ergonomic Accessories Kit', 1727366: 'Steam Frame Accessory Replacement Kit' };
      return { [id]: { success: true, data: { name: names[id] || `Pkg ${id}`, price: { currency: 'PLN', final: 27900 } } } };
    }],
    [/example\.org/, () => new Response('nope', { status: 404 })]
  ]);
  const config = makeConfig({
    watches: [{ id: 'ergo', type: 'steam', name: 'Steam Frame – Ergonomic Kit', packages: [1727363], url: 'https://store.steampowered.com/hardware/steamframe' }]
  });
  const store = new Store(config.dataPath);
  const secrets = { botToken: 'T', chatIds: [String(CHAT)], telegramApiBase: tg.base };
  ctx = createContext({ config, secrets, store, fetchImpl: fetch, version: '2.0.0+test' });
  const api = new TelegramApi('T', { baseUrl: tg.base });
  monitor = new Monitor(ctx, new Notifier(ctx, api));
  bot = new TelegramBot(ctx, api, monitor);
  await bot.start();
});

after(async () => {
  await bot.stop();
  await tg.close();
});

const sendTo = (chat) => (c) => c.method === 'sendMessage' && String(c.params.chat_id) === String(chat);
const callbacks = (kb) => kb.flat().map((b) => b.callback_data || b.url);

test('registers the command menu in both languages', () => {
  const cmds = tg.calls.filter((c) => c.method === 'setMyCommands');
  assert.equal(cmds.length, 3);
  assert.deepEqual(cmds.map((c) => c.params.language_code ?? 'default'), ['default', 'pl', 'en']);
  assert.ok(cmds[1].params.commands.some((c) => c.command === 'stock' && c.description === 'Stan magazynu'));
  assert.ok(tg.calls.some((c) => c.method === 'setChatMenuButton'));
});

test('/menu shows the main menu with inline buttons', async () => {
  const from = tg.calls.length;
  tg.message(CHAT, '/menu');
  const call = await tg.waitFor(sendTo(CHAT), { from });
  assert.match(call.params.text, /Stock Bot/);
  assert.deepEqual(callbacks(call.params.reply_markup.inline_keyboard), ['stock', 'chk', 'wl', 'hist:0', 'set', 'mute', 'st', 'help']);
});

test('strangers get their chat id once, and /id works for anyone', async () => {
  let from = tg.calls.length;
  tg.message(999, '/menu');
  const call = await tg.waitFor(sendTo(999), { from });
  assert.match(call.params.text, /prywatny bot[\s\S]*999/);
  from = tg.calls.length;
  tg.message(999, '/stock');
  tg.message(999, '/id');
  const id = await tg.waitFor(sendTo(999), { from });
  assert.match(id.params.text, /<code>999<\/code>/);
  assert.equal(tg.calls.slice(from).filter(sendTo(999)).length, 1, 'second unauthorized message ignored');
});

test('check now button edits the message with results', async () => {
  const from = tg.calls.length;
  tg.callback(CHAT, 'chk', 55);
  const done = await tg.waitFor((c) => c.method === 'editMessageText' && /Wynik sprawdzenia/.test(c.params.text), { from });
  assert.equal(done.params.message_id, 55);
  assert.match(done.params.text, /Steam Frame – Ergonomic Kit<\/b>: zapisano stan początkowy/);
  assert.ok(tg.calls.slice(from).some((c) => c.method === 'answerCallbackQuery'));
  // the baseline announcement went to the chat too
  assert.ok(tg.calls.slice(from).some((c) => sendTo(CHAT)(c) && /Nowa obserwacja/.test(c.params.text)));
});

test('stock -> watch detail -> pause / resume', async () => {
  let from = tg.calls.length;
  tg.callback(CHAT, 'stock', 56);
  const stockView = await tg.waitFor((c) => c.method === 'editMessageText', { from });
  assert.match(stockView.params.text, /Stan magazynu[\s\S]*dostępne: 0\/1/);
  assert.ok(callbacks(stockView.params.reply_markup.inline_keyboard).includes('w:ergo'));

  from = tg.calls.length;
  tg.callback(CHAT, 'w:ergo', 56);
  const detail = await tg.waitFor((c) => c.method === 'editMessageText', { from });
  assert.match(detail.params.text, /Steam Frame Ergonomic Accessories Kit<\/a> · 279,00/);
  assert.ok(callbacks(detail.params.reply_markup.inline_keyboard).includes('https://store.steampowered.com/hardware/steamframe'));

  from = tg.calls.length;
  tg.callback(CHAT, 'wp:ergo', 56);
  const toast = await tg.waitFor((c) => c.method === 'answerCallbackQuery' && c.params.text, { from });
  assert.match(toast.params.text, /Wstrzymano/);
  assert.equal(ctx.getWatch('ergo').enabled, false);
  tg.callback(CHAT, 'wp:ergo', 56);
  await tg.waitFor((c) => c.method === 'answerCallbackQuery' && /Wznowiono/.test(c.params.text || ''), { from });
  assert.equal(ctx.getWatch('ergo').enabled, true);
});

test('interval button cycles through steps', async () => {
  const from = tg.calls.length;
  tg.callback(CHAT, 'wn:ergo', 57);
  await tg.waitFor((c) => c.method === 'answerCallbackQuery' && /co 2 min/.test(c.params.text || ''), { from });
  assert.equal(ctx.getWatch('ergo').intervalSeconds, 120);
});

test('settings toggles persist, language switch re-renders in English', async () => {
  let from = tg.calls.length;
  tg.callback(CHAT, 'sn:priceChange', 58);
  await tg.waitFor((c) => c.method === 'editMessageText', { from });
  assert.equal(ctx.notifyOn().priceChange, true);

  from = tg.calls.length;
  tg.callback(CHAT, 'sl', 58);
  const view = await tg.waitFor((c) => c.method === 'editMessageText', { from });
  assert.match(view.params.text, /Settings/);
  assert.equal(ctx.lang, 'en');
  tg.callback(CHAT, 'sl', 58);
  await tg.waitFor((c) => c.method === 'editMessageText' && /Ustawienia/.test(c.params.text), { from });
});

test('/mute 2h and /unmute', async () => {
  let from = tg.calls.length;
  tg.message(CHAT, '/mute 2h');
  const muted = await tg.waitFor(sendTo(CHAT), { from });
  assert.match(muted.params.text, /Wyciszono/);
  const until = Date.parse(ctx.store.settings.mutedUntil) - Date.now();
  assert.ok(until > 119 * 60000 && until <= 120 * 60000);
  from = tg.calls.length;
  tg.message(CHAT, '/unmute');
  await tg.waitFor(sendTo(CHAT), { from });
  assert.equal(ctx.mutedUntil(), null);
  assert.equal(parseDuration('1d'), 1440);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('soon'), null);
});

test('/add steam <id> creates a removable watch', async () => {
  let from = tg.calls.length;
  tg.message(CHAT, '/add steam 1727366');
  const done = await tg.waitFor((c) => c.method === 'editMessageText' && /Dodano obserwację/.test(c.params.text), { from });
  assert.match(done.params.text, /zapisano stan początkowy/);
  const added = ctx.watches().find((w) => w.custom);
  assert.deepEqual(added.packages, [1727366]);
  assert.ok(callbacks(done.params.reply_markup.inline_keyboard).includes(`wr:${added.id}`));

  from = tg.calls.length;
  tg.message(CHAT, '/add steam 1727366');
  await tg.waitFor((c) => c.method === 'editMessageText' && /już jest obserwowane/.test(c.params.text), { from });

  from = tg.calls.length;
  tg.callback(CHAT, `wR:${added.id}`, 60);
  await tg.waitFor((c) => c.method === 'editMessageText' && /Usunięto/.test(c.params.text), { from });
  assert.equal(ctx.watches().some((w) => w.custom), false);
  assert.equal(ctx.store.state.watches[added.id], undefined);
});

test('free text searches, a pasted link offers to add it', async () => {
  let from = tg.calls.length;
  tg.message(CHAT, 'ergonomic');
  const found = await tg.waitFor(sendTo(CHAT), { from });
  assert.match(found.params.text, /Wyniki dla „ergonomic”[\s\S]*Ergonomic Accessories Kit/);

  from = tg.calls.length;
  tg.message(CHAT, 'https://example.org/item');
  const offer = await tg.waitFor(sendTo(CHAT), { from });
  const addData = callbacks(offer.params.reply_markup.inline_keyboard)[0];
  assert.match(addData, /^addc:[0-9a-f]{8}$/);
  from = tg.calls.length;
  tg.callback(CHAT, addData, 61);
  await tg.waitFor((c) => c.method === 'editMessageText' && /Nie umiem automatycznie obserwować example\.org/.test(c.params.text), { from });
});

test('commands for other bots in groups are ignored; unknown commands get help', async () => {
  let from = tg.calls.length;
  tg.message(CHAT, '/menu@other_bot', { chat: { id: CHAT, type: 'group' } });
  tg.message(CHAT, '/nope');
  const reply = await tg.waitFor(sendTo(CHAT), { from });
  assert.match(reply.params.text, /Nie znam tej komendy/);
  assert.equal(tg.calls.slice(from).filter(sendTo(CHAT)).length, 1);
});

test('status and history views render', async () => {
  let from = tg.calls.length;
  tg.message(CHAT, '/status');
  const status = await tg.waitFor(sendTo(CHAT), { from });
  assert.match(status.params.text, /Wersja: v2\.0\.0\+test[\s\S]*Steam Frame – Ergonomic Kit[\s\S]*✅ OK/);

  stock[1727363] = true;
  await monitor.checkWatch('ergo');
  from = tg.calls.length;
  tg.message(CHAT, '/history');
  const history = await tg.waitFor(sendTo(CHAT), { from });
  assert.match(history.params.text, /Ostatnie zmiany[\s\S]*🟢 <a href=[^>]+>Steam Frame Ergonomic Accessories Kit/);
});
