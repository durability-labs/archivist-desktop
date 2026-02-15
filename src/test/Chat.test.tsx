import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Chat from '../pages/Chat';
import type { ConversationSummary } from '../lib/chatTypes';

// Mock the ChatContext
const mockChatReturn = {
  conversations: [] as ConversationSummary[],
  serverStatus: { running: true, port: 8088, totalUnread: 0, conversationCount: 0 },
  loading: false,
  error: null as string | null,
  totalUnread: 0,
  initiateSession: vi.fn(),
  sendMessage: vi.fn(),
  getMessages: vi.fn().mockResolvedValue([]),
  markRead: vi.fn(),
  deleteConversation: vi.fn(),
  getIdentity: vi.fn(),
  getSafetyNumber: vi.fn(),
  verifyPeer: vi.fn(),
  createGroup: vi.fn(),
  sendGroupMessage: vi.fn(),
  refreshConversations: vi.fn(),
};

vi.mock('../contexts/ChatContext', () => ({
  useChatContext: () => mockChatReturn,
}));

vi.mock('../hooks/usePeers', () => ({
  usePeers: () => ({
    peerList: { peers: [], stats: { totalPeers: 0, connectedPeers: 0, bytesSentTotal: 0, bytesReceivedTotal: 0 }, localPeerId: null, localAddresses: [], spr: null },
    loading: false,
    error: null,
    connectPeer: vi.fn(),
    disconnectPeer: vi.fn(),
    removePeer: vi.fn(),
    copySpr: vi.fn(),
    refreshPeers: vi.fn(),
  }),
}));

function renderChat(route = '/chat') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Chat />
    </MemoryRouter>
  );
}

describe('Chat page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to defaults before each test
    mockChatReturn.conversations = [];
    mockChatReturn.loading = false;
    mockChatReturn.error = null;
    mockChatReturn.totalUnread = 0;
  });

  it('shows loading state', () => {
    mockChatReturn.loading = true;
    renderChat();
    expect(screen.getByText('Chat')).toBeDefined();
  });

  it('shows empty conversation list', () => {
    renderChat();
    expect(screen.getByText('No conversations yet.')).toBeDefined();
  });

  it('renders conversation list', () => {
    mockChatReturn.conversations = [
      {
        id: 'dm:peer-abc',
        conversationType: 'direct',
        displayName: 'peer-a..abc',
        lastMessage: 'Hello!',
        lastMessageAt: new Date().toISOString(),
        unreadCount: 2,
        members: null,
      },
      {
        id: 'group-123',
        conversationType: 'group',
        displayName: 'Test Group',
        lastMessage: 'Group msg',
        lastMessageAt: new Date().toISOString(),
        unreadCount: 0,
        members: ['peer-a', 'peer-b'],
      },
    ];

    renderChat();

    expect(screen.getByText('peer-a..abc')).toBeDefined();
    expect(screen.getByText(/Test Group/)).toBeDefined();
    expect(screen.getByText('2')).toBeDefined(); // unread badge
  });

  it('shows error banner', () => {
    mockChatReturn.error = 'Connection failed';
    renderChat();
    expect(screen.getByText('Connection failed')).toBeDefined();
  });

  it('shows empty state when no conversation selected', () => {
    mockChatReturn.conversations = [{
      id: 'dm:peer-abc',
      conversationType: 'direct',
      displayName: 'peer-a..abc',
      lastMessage: null,
      lastMessageAt: null,
      unreadCount: 0,
      members: null,
    }];

    renderChat();
    expect(screen.getByText('Select a conversation or start a new chat from the Devices page.')).toBeDefined();
  });

  it('has New Group button in sidebar', () => {
    renderChat();
    expect(screen.getByText('New Group')).toBeDefined();
  });
});
