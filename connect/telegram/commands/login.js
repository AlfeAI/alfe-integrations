// The daemon loads this handler outside OpenClaw. The integration's own pinned
// dependency makes resolution independent of OpenClaw's private install layout.
import { handleTelegramLogin } from '@alfe.ai/openclaw-telegram';

export async function handle(payload) {
  // Never echo payloads or arbitrary exception text: login inputs are private.
  try {
    return await handleTelegramLogin(payload);
  } catch {
    return { status: 'error', result: { code: 'TELEGRAM_LOGIN_UNAVAILABLE', message: 'Telegram setup is temporarily unavailable.' } };
  }
}
