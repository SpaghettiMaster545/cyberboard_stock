// Sends a test message so you can confirm Telegram is configured correctly.
//   npm run test-telegram
import { secrets } from '../src/config.js';
import { sendMessage } from '../src/telegram.js';

async function main() {
  if (!secrets.botToken || secrets.chatIds.length === 0) {
    console.error(
      'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.'
    );
    process.exit(1);
  }
  await sendMessage(
    '\u2705 <b>Test message</b>\nYour Angry Miao stock bot can reach this chat.'
  );
  console.log(`Sent a test message to: ${secrets.chatIds.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
