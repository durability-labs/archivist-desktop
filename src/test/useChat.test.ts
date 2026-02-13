import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri APIs
const mockInvoke = vi.fn();
const mockListen = vi.fn().mockResolvedValue(() => {});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Must import after mocks
import { renderHook, waitFor } from '@testing-library/react';
import { useChat } from '../hooks/useChat';

describe('useChat hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(() => {});
  });

  it('fetches conversations on mount', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_conversations') return Promise.resolve([]);
      if (cmd === 'get_chat_server_status') return Promise.resolve({
        running: true, port: 8088, totalUnread: 0, conversationCount: 0,
      });
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useChat());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_conversations');
    expect(mockInvoke).toHaveBeenCalledWith('get_chat_server_status');
    expect(result.current.conversations).toEqual([]);
  });

  it('sends a message without peer address', async () => {
    const mockMsg = {
      id: 'msg-1',
      senderPeerId: 'me',
      content: { text: 'hello', replyTo: null, attachments: [] },
      timestamp: new Date().toISOString(),
      deliveryStatus: 'sending',
      isOutgoing: true,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_conversations') return Promise.resolve([]);
      if (cmd === 'get_chat_server_status') return Promise.resolve({
        running: true, port: 8088, totalUnread: 0, conversationCount: 0,
      });
      if (cmd === 'send_chat_message') return Promise.resolve(mockMsg);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useChat());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const msg = await result.current.sendMessage('dm:peer-1', 'hello');
    expect(msg.id).toBe('msg-1');
    expect(mockInvoke).toHaveBeenCalledWith('send_chat_message', {
      conversationId: 'dm:peer-1',
      text: 'hello',
      replyTo: null,
    });
  });

  it('creates a group without member addresses', async () => {
    const mockGroup = {
      groupId: 'g-1',
      groupName: 'Test',
      creatorPeerId: 'me',
      members: [],
      createdAt: new Date().toISOString(),
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_conversations') return Promise.resolve([]);
      if (cmd === 'get_chat_server_status') return Promise.resolve({
        running: true, port: 8088, totalUnread: 0, conversationCount: 0,
      });
      if (cmd === 'create_chat_group') return Promise.resolve(mockGroup);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useChat());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const group = await result.current.createGroup('Test', ['peer-a']);
    expect(group.groupId).toBe('g-1');
    expect(mockInvoke).toHaveBeenCalledWith('create_chat_group', {
      name: 'Test',
      memberPeerIds: ['peer-a'],
    });
  });

  it('registers event listeners', async () => {
    mockInvoke.mockResolvedValue([]);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_conversations') return Promise.resolve([]);
      if (cmd === 'get_chat_server_status') return Promise.resolve({
        running: true, port: 8088, totalUnread: 0, conversationCount: 0,
      });
      return Promise.resolve(null);
    });

    renderHook(() => useChat());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    const eventNames = mockListen.mock.calls.map((c: unknown[]) => c[0]);
    expect(eventNames).toContain('chat-message-received');
    expect(eventNames).toContain('chat-message-delivered');
    expect(eventNames).toContain('chat-delivery-failed');
    expect(eventNames).toContain('chat-unread-count');
  });
});
