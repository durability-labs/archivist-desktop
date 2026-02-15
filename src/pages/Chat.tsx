import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChatContext } from '../contexts/ChatContext';
import { usePeers } from '../hooks/usePeers';
import SafetyNumber from '../components/SafetyNumber';
import type { StoredMessage } from '../lib/chatTypes';
import '../styles/Chat.css';

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function deliveryIcon(status: string): string {
  switch (status) {
    case 'sending': return '...';
    case 'delivered': return '\u2713';
    case 'read': return '\u2713\u2713';
    case 'failed': return '\u2717';
    default: return '';
  }
}

export default function Chat() {
  const { conversationId: routeConvId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const {
    conversations,
    loading,
    error,
    sendMessage,
    getMessages,
    markRead,
    deleteConversation,
    getSafetyNumber,
    verifyPeer,
    sendGroupMessage,
    createGroup,
  } = useChatContext();
  const { peerList } = usePeers();

  const [activeConv, setActiveConv] = useState<string | null>(routeConvId ?? null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [safetyPeerId, setSafetyPeerId] = useState('');
  const [replyTo, setReplyTo] = useState<StoredMessage | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load messages when active conversation changes
  const loadMessages = useCallback(async (convId: string) => {
    try {
      const msgs = await getMessages(convId, 100);
      setMessages(msgs);
      await markRead(convId);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }, [getMessages, markRead]);

  useEffect(() => {
    if (activeConv) {
      loadMessages(activeConv);
    }
  }, [activeConv, loadMessages]);

  // Sync route param
  useEffect(() => {
    if (routeConvId && routeConvId !== activeConv) {
      setActiveConv(routeConvId);
    }
  }, [routeConvId, activeConv]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh messages periodically
  useEffect(() => {
    if (!activeConv) return;
    const interval = setInterval(() => loadMessages(activeConv), 3000);
    return () => clearInterval(interval);
  }, [activeConv, loadMessages]);

  const handleSend = async () => {
    if (!inputText.trim() || !activeConv || sending) return;
    setSending(true);
    try {
      const conv = conversations.find(c => c.id === activeConv);
      if (!conv) return;

      const replyToId = replyTo?.id;

      if (conv.conversationType === 'group') {
        await sendGroupMessage(activeConv, inputText.trim(), replyToId);
      } else {
        await sendMessage(activeConv, inputText.trim(), replyToId);
      }
      setInputText('');
      setReplyTo(null);
      await loadMessages(activeConv);
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      setSending(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) return;
    try {
      const group = await createGroup(groupName.trim(), selectedMembers);
      setShowNewGroup(false);
      setGroupName('');
      setSelectedMembers([]);
      selectConversation(group.groupId);
    } catch (e) {
      console.error('Create group failed:', e);
    }
  };

  const toggleMember = (peerId: string) => {
    setSelectedMembers(prev =>
      prev.includes(peerId) ? prev.filter(id => id !== peerId) : [...prev, peerId]
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectConversation = (convId: string) => {
    setActiveConv(convId);
    navigate(`/chat/${encodeURIComponent(convId)}`);
  };

  const handleDelete = async (convId: string) => {
    if (confirm('Delete this conversation?')) {
      await deleteConversation(convId);
      if (activeConv === convId) {
        setActiveConv(null);
        setMessages([]);
        navigate('/chat');
      }
    }
  };

  const openSafetyNumber = (peerId: string) => {
    setSafetyPeerId(peerId);
    setShowSafetyNumber(true);
  };

  const activeConvInfo = conversations.find(c => c.id === activeConv);

  if (loading) {
    return (
      <div className="page chat-page">
        <h2>Chat</h2>
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="page chat-page">
      <h2>Chat</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="chat-container">
        {/* Left panel: conversation list */}
        <div className="chat-sidebar">
          <div className="chat-sidebar-header">
            <h3>Conversations</h3>
            <button className="btn btn-sm" onClick={() => setShowNewGroup(true)}>New Group</button>
          </div>
          {conversations.length === 0 ? (
            <div className="chat-empty">
              <p>No conversations yet.</p>
              <p className="hint">Start a chat from the Devices page by clicking "Chat" on a connected peer.</p>
            </div>
          ) : (
            <div className="conversation-list">
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  className={`conversation-item ${activeConv === conv.id ? 'active' : ''}`}
                  onClick={() => selectConversation(conv.id)}
                >
                  <div className="conversation-info">
                    <div className="conversation-name">
                      {conv.conversationType === 'group' ? '[G] ' : ''}
                      {conv.displayName}
                    </div>
                    {conv.lastMessage && (
                      <div className="conversation-preview">
                        {conv.lastMessage.length > 40
                          ? conv.lastMessage.slice(0, 40) + '...'
                          : conv.lastMessage}
                      </div>
                    )}
                  </div>
                  <div className="conversation-meta">
                    {conv.lastMessageAt && (
                      <span className="conversation-time">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    )}
                    {conv.unreadCount > 0 && (
                      <span className="unread-badge">{conv.unreadCount}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: active conversation */}
        <div className="chat-main">
          {activeConv && activeConvInfo ? (
            <>
              <div className="chat-header">
                <div className="chat-header-info">
                  <h3>{activeConvInfo.displayName}</h3>
                  {activeConvInfo.conversationType === 'group' && activeConvInfo.members && (
                    <span className="member-count">{activeConvInfo.members.length} members</span>
                  )}
                </div>
                <div className="chat-header-actions">
                  {activeConvInfo.conversationType === 'direct' && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        const peerId = activeConv.replace('dm:', '');
                        openSafetyNumber(peerId);
                      }}
                      title="Verify identity"
                    >
                      Verify
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(activeConv)}
                    title="Delete conversation"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="chat-messages">
                {messages.map(msg => {
                  const replyMsg = msg.content.replyTo
                    ? messages.find(m => m.id === msg.content.replyTo)
                    : null;
                  return (
                    <div
                      key={msg.id}
                      className={`message ${msg.isOutgoing ? 'outgoing' : 'incoming'}`}
                    >
                      {!msg.isOutgoing && activeConvInfo.conversationType === 'group' && (
                        <div className="message-sender">
                          {msg.senderPeerId.length > 12
                            ? `${msg.senderPeerId.slice(0, 6)}..${msg.senderPeerId.slice(-4)}`
                            : msg.senderPeerId}
                        </div>
                      )}
                      {msg.content.replyTo && (
                        <div className="message-reply-indicator">
                          {replyMsg
                            ? replyMsg.content.text.length > 60
                              ? replyMsg.content.text.slice(0, 60) + '...'
                              : replyMsg.content.text
                            : 'Reply'}
                        </div>
                      )}
                      <div className="message-text">{msg.content.text}</div>
                      {msg.content.attachments.length > 0 && (
                        <div className="message-attachments">
                          {msg.content.attachments.map((att, i) => (
                            <div key={i} className="attachment-chip">
                              {att.filename} ({(att.sizeBytes / 1024).toFixed(1)}KB)
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="message-meta">
                        <button
                          className="btn-reply"
                          onClick={() => setReplyTo(msg)}
                          title="Reply"
                        >
                          Reply
                        </button>
                        <span className="message-time">{formatTime(msg.timestamp)}</span>
                        {msg.isOutgoing && (
                          <span className={`delivery-status ${msg.deliveryStatus}`}>
                            {deliveryIcon(msg.deliveryStatus)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-input-area">
                {replyTo && (
                  <div className="reply-preview">
                    <span className="reply-preview-text">
                      Replying to: {replyTo.content.text.length > 50
                        ? replyTo.content.text.slice(0, 50) + '...'
                        : replyTo.content.text}
                    </span>
                    <button
                      className="btn-reply-cancel"
                      onClick={() => setReplyTo(null)}
                      title="Cancel reply"
                    >
                      &times;
                    </button>
                  </div>
                )}
                <div className="chat-input-row">
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    className="chat-input"
                    rows={1}
                    disabled={sending}
                  />
                  <button
                    className="btn btn-primary send-btn"
                    onClick={handleSend}
                    disabled={!inputText.trim() || sending}
                  >
                    {sending ? '...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="chat-empty-state">
              <p>Select a conversation or start a new chat from the Devices page.</p>
            </div>
          )}
        </div>
      </div>

      {showSafetyNumber && (
        <SafetyNumber
          peerId={safetyPeerId}
          getSafetyNumber={getSafetyNumber}
          onVerify={verifyPeer}
          onClose={() => setShowSafetyNumber(false)}
        />
      )}

      {showNewGroup && (
        <div className="safety-number-modal" onClick={() => setShowNewGroup(false)}>
          <div className="safety-number-content" onClick={e => e.stopPropagation()}>
            <h3>New Group</h3>
            <div className="group-form">
              <input
                type="text"
                className="chat-input"
                placeholder="Group name..."
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                style={{ marginBottom: '1rem', width: '100%' }}
              />
              <div className="group-member-selector">
                <p style={{ fontSize: '0.8rem', opacity: 0.6, margin: '0 0 0.5rem' }}>Select members:</p>
                {peerList.peers.filter(p => p.connected).length === 0 ? (
                  <p style={{ fontSize: '0.8rem', opacity: 0.4 }}>No connected peers available.</p>
                ) : (
                  peerList.peers.filter(p => p.connected).map(peer => (
                    <label key={peer.id} className="member-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedMembers.includes(peer.id)}
                        onChange={() => toggleMember(peer.id)}
                      />
                      <span>{peer.id.slice(0, 8)}...{peer.id.slice(-6)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={handleCreateGroup}
                disabled={!groupName.trim() || selectedMembers.length === 0}
              >
                Create Group
              </button>
              <button className="btn btn-secondary" onClick={() => setShowNewGroup(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
