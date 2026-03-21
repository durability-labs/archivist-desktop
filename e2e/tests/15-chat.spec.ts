import {
  navigateTo,
  hasText,
  isDisplayed,
  getCount,
  SEL,
} from '../helpers';

/**
 * Phase 5 — Chat page E2E tests
 */

// Chat page and route were removed from the app nav in the nav restructure.
// All tests are skipped. The Chat route no longer exists in App.tsx.
describe.skip('Chat page (REMOVED)', () => {
  it('should load chat page with empty state', async () => {
    await navigateTo('Chat');

    const chatHeading = await $(SEL.chatHeading);
    await expect(chatHeading).toHaveText('Chat');
    const chatPage = await $(SEL.chatPage);
    await chatPage.waitForDisplayed({ timeout: 5_000 });

    // Either empty conversation list or populated list should be present
    const hasConversations = await isDisplayed(SEL.conversationList, 2000);
    if (!hasConversations) {
      const chatEmpty = await $(SEL.chatEmpty);
      await expect(chatEmpty).toBeDisplayed();
    }

    // Empty state in the main panel (no conversation selected)
    const chatEmptyState = await $(SEL.chatEmptyState);
    await expect(chatEmptyState).toBeDisplayed();
  });

  it('should not show chat input when no conversation is selected', async () => {
    await navigateTo('Chat');

    // Empty state should be visible
    const chatEmptyState = await $(SEL.chatEmptyState);
    await chatEmptyState.waitForDisplayed({ timeout: 5_000 });

    // Chat input should NOT be visible (only shows in an active conversation)
    const chatInputArea = await $('.chat-input-area');
    await expect(chatInputArea).not.toBeDisplayed();
  });

  it('should have Chat nav link in sidebar', async () => {
    // Check that the Chat link is visible in the sidebar
    const chatNav = await hasText('.sidebar .nav-link', 'Chat');
    await chatNav.waitForDisplayed({ timeout: 5_000 });

    // Click it and verify we're on the chat page
    await chatNav.click();
    await browser.pause(500);
    const chatPage = await $(SEL.chatPage);
    await chatPage.waitForDisplayed({ timeout: 5_000 });
  });

  it('should show Chat button on connected peer cards in Devices', async () => {
    await navigateTo('My Devices');

    // Check if there are connected peers
    const connectedPeerCards = $$('.device-card.peer:not(.offline)');
    const count = await connectedPeerCards.length;

    if (count > 0) {
      // Each connected peer card should have a Chat button
      for (let i = 0; i < count; i++) {
        const chatBtn = await connectedPeerCards[i].$('*=Chat');
        await expect(chatBtn).toBeDisplayed();
      }
    } else {
      // No connected peers — verify the empty state message
      const emptyMsg = await $('*=No devices connected yet');
      await emptyMsg.waitForDisplayed({ timeout: 5_000 });
    }
  });

  it('should have New Group button in sidebar header', async () => {
    await navigateTo('Chat');

    const newGroupBtn = await $(SEL.newGroupBtn);
    await newGroupBtn.waitForDisplayed({ timeout: 5_000 });
    await expect(newGroupBtn).toHaveText('New Group');
  });

  it('should open and close New Group modal', async () => {
    await navigateTo('Chat');

    // Click New Group button
    const newGroupBtn = await $(SEL.newGroupBtn);
    await newGroupBtn.click();

    // Modal should appear with group name input
    const modal = await $(SEL.safetyNumberModal);
    await modal.waitForDisplayed({ timeout: 3_000 });

    // Should have group name input
    const groupNameInput = await modal.$('input[placeholder="Group name..."]');
    await expect(groupNameInput).toBeDisplayed();

    // Should have "Select members" text
    const selectMembers = await modal.$('*=Select members');
    await expect(selectMembers).toBeDisplayed();

    // Create Group button should be disabled when name is empty
    const createBtn = await hasText('button', 'Create Group');
    await expect(createBtn).toBeDisabled();

    // Close modal by clicking Cancel
    const cancelBtn = await hasText('button', 'Cancel');
    await cancelBtn.click();
    const modalAfter = await $(SEL.safetyNumberModal);
    await modalAfter.waitForDisplayed({ timeout: 2_000, reverse: true });
  });

  it('should show chat input when conversation is selected', async () => {
    await navigateTo('Chat');

    // Check if conversations exist
    const convItems = $$(SEL.conversationItem);
    const count = await convItems.length;

    if (count > 0) {
      // Click the first conversation
      await convItems[0].click();
      await browser.pause(500);

      // Chat input should now be visible
      const chatInput = await $(SEL.chatInput);
      await chatInput.waitForDisplayed({ timeout: 3_000 });
      const sendBtn = await $(SEL.sendBtn);
      await expect(sendBtn).toBeDisplayed();

      // Verify placeholder text
      await expect(chatInput).toHaveAttr('placeholder', 'Type a message...');

      // Type something and verify send button is enabled
      await chatInput.setValue('test message');
      await expect(sendBtn).not.toBeDisabled();

      // Clear text and verify send button is disabled
      await chatInput.setValue('');
      await expect(sendBtn).toBeDisabled();
    } else {
      // Skip if no conversations exist — verify empty state
      const chatEmptyState = await $(SEL.chatEmptyState);
      await expect(chatEmptyState).toBeDisplayed();
    }
  });

  it('should show reply UI when Reply button is clicked', async () => {
    await navigateTo('Chat');

    const convItems = $$(SEL.conversationItem);
    const count = await convItems.length;

    if (count > 0) {
      // Click the first conversation
      await convItems[0].click();
      await browser.pause(500);

      // Check if there are messages
      const messageElements = $$(SEL.message);
      const msgCount = await messageElements.length;

      if (msgCount > 0) {
        // Hover over first message to reveal Reply button
        await messageElements[0].moveTo();
        await browser.pause(200);

        const replyBtn = await messageElements[0].$('.btn-reply');
        const replyVisible = await replyBtn.isDisplayed().catch(() => false);
        if (replyVisible) {
          await replyBtn.click();

          // Reply preview should appear
          const replyPreview = await $(SEL.replyPreview);
          await replyPreview.waitForDisplayed({ timeout: 2_000 });

          // Cancel reply
          const replyCancelBtn = await $(SEL.replyCancelBtn);
          await replyCancelBtn.click();
          await replyPreview.waitForDisplayed({ timeout: 2_000, reverse: true });
        }
      }
    }
  });

  it('should show safety number modal for DM conversations', async () => {
    await navigateTo('Chat');

    // Find a DM conversation (id starts with "dm:")
    const convItems = $$(SEL.conversationItem);
    const count = await convItems.length;

    let foundDm = false;
    for (let i = 0; i < count; i++) {
      await convItems[i].click();
      await browser.pause(300);

      // Check if Verify button appears (only for DM conversations)
      const verifyVisible = await isDisplayed('//*[contains(@class, "chat-header-actions")]//*[contains(., "Verify")]', 1000);
      if (verifyVisible) {
        foundDm = true;

        // Click Verify
        const verifyBtn = await hasText('.chat-header-actions button', 'Verify');
        await verifyBtn.click();

        // Safety number modal should appear
        const safetyModal = await $(SEL.safetyNumberModal);
        await safetyModal.waitForDisplayed({ timeout: 3_000 });

        // Should have safety number grid
        const safetyGrid = await $(SEL.safetyNumberGrid);
        await expect(safetyGrid).toBeDisplayed();

        // Close by clicking Close button
        const closeBtn = await hasText('.safety-number-content button', 'Close');
        await closeBtn.click();
        await safetyModal.waitForDisplayed({ timeout: 2_000, reverse: true });
        break;
      }
    }

    // If no DM conversations, test passes — just verify page loaded
    if (!foundDm) {
      const chatPage = await $(SEL.chatPage);
      await expect(chatPage).toBeDisplayed();
    }
  });

  it('should not show error banner (chat server running)', async () => {
    await navigateTo('Chat');

    const chatPage = await $(SEL.chatPage);
    await chatPage.waitForDisplayed({ timeout: 5_000 });

    // Should not have an error banner
    const hasError = await isDisplayed('.error-banner', 1000);
    expect(hasError).toBeFalsy();
  });
});
