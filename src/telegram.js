import { secrets } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send an HTML message to every configured chat id.
 * Silently no-ops (with a warning) if Telegram is not configured, so the
 * bot can still build its stock baseline during first-time/local testing.
 */
export async function sendMessage(text) {
  if (!secrets.botToken) {
    console.warn('TELEGRAM_BOT_TOKEN not set - skipping notification.');
    return;
  }
  if (secrets.chatIds.length === 0) {
    console.warn('TELEGRAM_CHAT_ID not set - skipping notification.');
    return;
  }

  const url = `https://api.telegram.org/bot${secrets.botToken}/sendMessage`;

  for (const chatId of secrets.chatIds) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          })
        });

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          const wait = ((data.parameters && data.parameters.retry_after) || 2) * 1000;
          await sleep(wait);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Telegram HTTP ${res.status}: ${body}`);
        }
        break; // success
      } catch (err) {
        console.error(
          `Telegram send failed for chat ${chatId} (attempt ${attempt}): ${err.message}`
        );
        if (attempt < 3) await sleep(1000 * attempt);
      }
    }
    await sleep(400); // gentle pacing between chats
  }
}
