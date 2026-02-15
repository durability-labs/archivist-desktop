import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ConversationSummary,
  StoredMessage,
  ChatServerStatus,
  ChatIdentityInfo,
  SafetyNumberInfo,
  GroupInfo,
} from '../lib/chatTypes';

export function useChat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [serverStatus, setServerStatus] = useState<ChatServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const result = await invoke<ConversationSummary[]>('get_conversations');
      setConversations(result);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'Failed to get conversations'));
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await invoke<ChatServerStatus>('get_chat_server_status');
      setServerStatus(result);
    } catch (e) {
      console.error('Failed to get chat status:', e);
    }
  }, []);

  const initiateSession = useCallback(async (peerId: string, peerAddress: string): Promise<string> => {
    const conversationId = await invoke<string>('initiate_chat_session', { peerId, peerAddress });
    await refreshConversations();
    return conversationId;
  }, [refreshConversations]);

  const sendMessage = useCallback(async (
    conversationId: string,
    text: string,
    replyTo?: string,
  ): Promise<StoredMessage> => {
    const msg = await invoke<StoredMessage>('send_chat_message', {
      conversationId,
      text,
      replyTo: replyTo ?? null,
    });
    await refreshConversations();
    return msg;
  }, [refreshConversations]);

  const getMessages = useCallback(async (
    conversationId: string,
    limit?: number,
    before?: string,
  ): Promise<StoredMessage[]> => {
    return invoke<StoredMessage[]>('get_conversation_messages', {
      conversationId,
      limit: limit ?? null,
      before: before ?? null,
    });
  }, []);

  const markRead = useCallback(async (conversationId: string) => {
    await invoke('mark_messages_read', { conversationId });
    await refreshConversations();
  }, [refreshConversations]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    await invoke('delete_conversation', { conversationId });
    await refreshConversations();
  }, [refreshConversations]);

  const getIdentity = useCallback(async (): Promise<ChatIdentityInfo> => {
    return invoke<ChatIdentityInfo>('get_chat_identity');
  }, []);

  const getSafetyNumber = useCallback(async (peerId: string): Promise<SafetyNumberInfo> => {
    return invoke<SafetyNumberInfo>('get_safety_number', { peerId });
  }, []);

  const verifyPeer = useCallback(async (peerId: string) => {
    await invoke('verify_peer_identity', { peerId });
  }, []);

  const createGroup = useCallback(async (
    name: string,
    memberPeerIds: string[],
  ): Promise<GroupInfo> => {
    const group = await invoke<GroupInfo>('create_chat_group', {
      name,
      memberPeerIds,
    });
    await refreshConversations();
    return group;
  }, [refreshConversations]);

  const sendGroupMessage = useCallback(async (
    groupId: string,
    text: string,
    replyTo?: string,
  ): Promise<StoredMessage> => {
    const msg = await invoke<StoredMessage>('send_group_message', {
      groupId,
      text,
      replyTo: replyTo ?? null,
    });
    await refreshConversations();
    return msg;
  }, [refreshConversations]);

  // Initialize
  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([refreshConversations(), refreshStatus()]);
      setLoading(false);
    }
    init();

    // Poll conversations every 5s
    const interval = setInterval(() => {
      refreshConversations();
      refreshStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshConversations, refreshStatus]);

  // Listen to real-time events for instant updates
  useEffect(() => {
    const unlistenReceived = listen<{
      conversationId: string;
      message: StoredMessage;
    }>('chat-message-received', () => {
      refreshConversations();
    });

    const unlistenDelivered = listen<{
      messageId: string;
      conversationId: string;
    }>('chat-message-delivered', () => {
      refreshConversations();
    });

    const unlistenFailed = listen<{
      messageId: string;
      conversationId: string;
      error: string;
    }>('chat-delivery-failed', () => {
      refreshConversations();
    });

    const unlistenUnread = listen<{
      total: number;
      byConversation: Record<string, number>;
    }>('chat-unread-count', () => {
      refreshConversations();
      refreshStatus();
    });

    return () => {
      unlistenReceived.then(fn => fn());
      unlistenDelivered.then(fn => fn());
      unlistenFailed.then(fn => fn());
      unlistenUnread.then(fn => fn());
    };
  }, [refreshConversations, refreshStatus]);

  const totalUnread = serverStatus?.totalUnread ?? conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return {
    conversations,
    serverStatus,
    loading,
    error,
    totalUnread,
    initiateSession,
    sendMessage,
    getMessages,
    markRead,
    deleteConversation,
    getIdentity,
    getSafetyNumber,
    verifyPeer,
    createGroup,
    sendGroupMessage,
    refreshConversations,
  };
}
