// Finds the Telegram chat id(s) that have messaged your bot.
//
// Usage:
//   1. Open Telegram and send any message (e.g. "hi") to your bot.
//   2. Run:  npm run chat-id
//   3. Copy the chat_id into .env (TELEGRAM_CHAT_ID) or a GitHub secret.
//
// Only works while the bot itself is NOT running (both would poll getUpdates).
// If the bot is already running, simply send it /id instead.
import { secrets } from '../src/config.js';

async function main() {
  if (!secrets.botToken) {
    console.error('TELEGRAM_BOT_TOKEN is not set. Add it to your .env first.');
    process.exit(1);
  }

  const res = await fetch(
    `${secrets.telegramApiBase}/bot${secrets.botToken}/getUpdates`
  );
  const data = await res.json();

  if (!data.ok) {
    if (data.error_code === 409) {
      console.error('The bot is already running and receiving updates. Send /id to the bot instead.');
      process.exit(1);
    }
    console.error('Telegram error:', JSON.stringify(data));
    process.exit(1);
  }

  const chats = new Map();
  for (const u of data.result || []) {
    const source = u.message || u.channel_post || u.edited_message || u.my_chat_member;
    const chat = source && source.chat;
    if (chat) chats.set(chat.id, chat);
  }

  if (chats.size === 0) {
    console.log(
      'No chats found yet.\n' +
        '-> Open Telegram, send a message to your bot, then run this again.\n' +
        '   (For a group/channel, add the bot and post a message there.)'
    );
    return;
  }

  console.log('Found chat(s):\n');
  for (const chat of chats.values()) {
    const name =
      chat.title ||
      [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
      chat.username ||
      '(unknown)';
    console.log(`  chat_id = ${chat.id}   type = ${chat.type}   name = ${name}`);
  }
  console.log(
    '\nPut the chat_id you want into TELEGRAM_CHAT_ID (.env locally, or a GitHub secret).'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
