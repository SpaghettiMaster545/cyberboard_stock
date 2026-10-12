// Sends a test message so you can confirm Telegram is configured correctly.
//   npm run test-telegram
import { secrets } from '../src/config.js';
import { TelegramApi } from '../src/telegram/api.js';

async function main() {
  if (!secrets.botToken || secrets.chatIds.length === 0) {
    console.error(
      'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.'
    );
    process.exit(1);
  }
  const api = new TelegramApi(secrets.botToken, { baseUrl: secrets.telegramApiBase });
  for (const chatId of secrets.chatIds) {
    await api.call('sendMessage', {
      chat_id: chatId,
      text: '✅ <b>Test message</b>\nYour stock bot can reach this chat. Send /menu to open the bot menu.',
      parse_mode: 'HTML'
    });
  }
  console.log(`Sent a test message to: ${secrets.chatIds.join(', ')}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
