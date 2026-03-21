import { ensurePastOnboarding } from '../helpers';

/**
 * IRC Chat component UI smoke tests.
 *
 * These tests run against the Tauri WebView. We verify
 * the IRC chat UI structure renders on the Dashboard.
 */

describe('IRC Chat component UI', () => {
  before(async () => {
    await ensurePastOnboarding();
  });

  it('IRC chat component renders in Dashboard', async () => {
    await browser.url('/');
    await browser.pause(1000);

    const ircChat = await $('.irc-chat');
    await ircChat.waitForDisplayed({ timeout: 10000 });
  });

  it('IRC header shows channel name #archivist', async () => {
    await browser.url('/');
    await browser.pause(1000);

    const channel = await $('.irc-channel');
    await channel.waitForDisplayed({ timeout: 10000 });
    await expect(channel).toHaveText('#archivist');
  });

  it('IRC status dot is present', async () => {
    await browser.url('/');
    await browser.pause(1000);

    const dot = await $('.irc-dot');
    await dot.waitForDisplayed({ timeout: 10000 });
  });

  it('IRC messages area is present', async () => {
    await browser.url('/');
    await browser.pause(1000);

    const messages = await $('.irc-messages');
    await messages.waitForDisplayed({ timeout: 10000 });
  });

  it('IRC input is present and disabled when not connected', async () => {
    await browser.url('/');
    await browser.pause(1000);

    const input = await $('.irc-input');
    await input.waitForDisplayed({ timeout: 10000 });
    expect(await input.isEnabled()).toBe(false);
  });

  it('IRC shows empty state text when not connected', async () => {
    await browser.url('/');
    await browser.pause(1000);

    const empty = await $('.irc-empty');
    await empty.waitForDisplayed({ timeout: 10000 });
    // Should show connecting or disconnected message
    const text = await empty.getText();
    expect(
      text?.includes('Connecting to Libera.Chat') ||
      text?.includes('Click Connect')
    ).toBeTruthy();
  });
});
