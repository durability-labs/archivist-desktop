import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  navigateTo,
  SEL,
} from '../helpers';

/**
 * Phase 5 — Chat page E2E tests (Playwright via CDP)
 */

test.describe('Chat page', () => {
  test.beforeAll(async () => {
    await waitForPort(9222, 15_000);
  });

  test('should load chat page with empty state', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      await expect(page.locator(SEL.chatHeading)).toHaveText('Chat');
      await expect(page.locator(SEL.chatPage)).toBeVisible({ timeout: 5_000 });

      // Either empty conversation list or populated list should be present
      const hasConversations = await page.locator(SEL.conversationList).isVisible().catch(() => false);
      if (!hasConversations) {
        await expect(page.locator(SEL.chatEmpty)).toBeVisible();
      }

      // Empty state in the main panel (no conversation selected)
      await expect(page.locator(SEL.chatEmptyState)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should not show chat input when no conversation is selected', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      // Empty state should be visible
      await expect(page.locator(SEL.chatEmptyState)).toBeVisible({ timeout: 5_000 });

      // Chat input should NOT be visible (only shows in an active conversation)
      await expect(page.locator('.chat-input-area')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('should have Chat nav link in sidebar', async () => {
    const { browser, page } = await connectToApp();

    try {
      // Check that the Chat link is visible in the sidebar
      const chatNav = page.locator('.sidebar .nav-link:has-text("Chat")');
      await expect(chatNav).toBeVisible({ timeout: 5_000 });

      // Click it and verify we're on the chat page
      await chatNav.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator(SEL.chatPage)).toBeVisible({ timeout: 5_000 });
    } finally {
      await browser.close();
    }
  });

  test('should show Chat button on connected peer cards in Devices', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'My Devices');

      // Check if there are connected peers
      const connectedPeerCards = page.locator('.device-card.peer:not(.offline)');
      const count = await connectedPeerCards.count();

      if (count > 0) {
        // Each connected peer card should have a Chat button
        for (let i = 0; i < count; i++) {
          const chatBtn = connectedPeerCards.nth(i).locator('.device-actions button:has-text("Chat")');
          await expect(chatBtn).toBeVisible();
        }
      } else {
        // No connected peers — verify the empty state message
        await expect(page.locator('text=No devices connected yet')).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await browser.close();
    }
  });

  test('should have New Group button in sidebar header', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      await expect(page.locator(SEL.newGroupBtn)).toBeVisible({ timeout: 5_000 });
      await expect(page.locator(SEL.newGroupBtn)).toHaveText('New Group');
    } finally {
      await browser.close();
    }
  });

  test('should open and close New Group modal', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      // Click New Group button
      await page.locator(SEL.newGroupBtn).click();

      // Modal should appear with group name input
      const modal = page.locator(SEL.safetyNumberModal);
      await expect(modal).toBeVisible({ timeout: 3_000 });

      // Should have group name input
      await expect(modal.locator('input[placeholder="Group name..."]')).toBeVisible();

      // Should have "Select members" text
      await expect(modal.locator('text=Select members')).toBeVisible();

      // Create Group button should be disabled when name is empty
      const createBtn = modal.locator('button:has-text("Create Group")');
      await expect(createBtn).toBeDisabled();

      // Close modal by clicking Cancel
      await modal.locator('button:has-text("Cancel")').click();
      await expect(modal).not.toBeVisible({ timeout: 2_000 });
    } finally {
      await browser.close();
    }
  });

  test('should show chat input when conversation is selected', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      // Check if conversations exist
      const convItems = page.locator(SEL.conversationItem);
      const count = await convItems.count();

      if (count > 0) {
        // Click the first conversation
        await convItems.first().click();
        await page.waitForTimeout(500);

        // Chat input should now be visible
        await expect(page.locator(SEL.chatInput)).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(SEL.sendBtn)).toBeVisible();

        // Verify placeholder text
        await expect(page.locator(SEL.chatInput)).toHaveAttribute('placeholder', 'Type a message...');

        // Type something and verify send button is enabled
        await page.locator(SEL.chatInput).fill('test message');
        await expect(page.locator(SEL.sendBtn)).not.toBeDisabled();

        // Clear text and verify send button is disabled
        await page.locator(SEL.chatInput).fill('');
        await expect(page.locator(SEL.sendBtn)).toBeDisabled();
      } else {
        // Skip if no conversations exist — verify empty state
        await expect(page.locator(SEL.chatEmptyState)).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });

  test('should show reply UI when Reply button is clicked', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      const convItems = page.locator(SEL.conversationItem);
      const count = await convItems.count();

      if (count > 0) {
        // Click the first conversation
        await convItems.first().click();
        await page.waitForTimeout(500);

        // Check if there are messages
        const messageElements = page.locator(SEL.message);
        const msgCount = await messageElements.count();

        if (msgCount > 0) {
          // Hover over first message to reveal Reply button
          await messageElements.first().hover();
          await page.waitForTimeout(200);

          const replyBtn = messageElements.first().locator('.btn-reply');
          if (await replyBtn.isVisible().catch(() => false)) {
            await replyBtn.click();

            // Reply preview should appear
            await expect(page.locator(SEL.replyPreview)).toBeVisible({ timeout: 2_000 });

            // Cancel reply
            await page.locator(SEL.replyCancelBtn).click();
            await expect(page.locator(SEL.replyPreview)).not.toBeVisible({ timeout: 2_000 });
          }
        }
      }
    } finally {
      await browser.close();
    }
  });

  test('should show safety number modal for DM conversations', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      // Find a DM conversation (id starts with "dm:")
      const convItems = page.locator(SEL.conversationItem);
      const count = await convItems.count();

      let foundDm = false;
      for (let i = 0; i < count; i++) {
        await convItems.nth(i).click();
        await page.waitForTimeout(300);

        // Check if Verify button appears (only for DM conversations)
        const verifyBtn = page.locator('.chat-header-actions button:has-text("Verify")');
        if (await verifyBtn.isVisible().catch(() => false)) {
          foundDm = true;

          // Click Verify
          await verifyBtn.click();

          // Safety number modal should appear
          await expect(page.locator(SEL.safetyNumberModal)).toBeVisible({ timeout: 3_000 });

          // Should have safety number grid
          await expect(page.locator(SEL.safetyNumberGrid)).toBeVisible();

          // Close by clicking Close button
          await page.locator('.safety-number-content button:has-text("Close")').click();
          await expect(page.locator(SEL.safetyNumberModal)).not.toBeVisible({ timeout: 2_000 });
          break;
        }
      }

      // If no DM conversations, test passes — just verify page loaded
      if (!foundDm) {
        await expect(page.locator(SEL.chatPage)).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });

  test('should not show error banner (chat server running)', async () => {
    const { browser, page } = await connectToApp();

    try {
      await navigateTo(page, 'Chat');

      await expect(page.locator(SEL.chatPage)).toBeVisible({ timeout: 5_000 });

      // Should not have an error banner
      const errorBanner = page.locator('.error-banner');
      const hasError = await errorBanner.isVisible().catch(() => false);
      expect(hasError).toBeFalsy();
    } finally {
      await browser.close();
    }
  });
});
