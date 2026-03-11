import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useIrc, IrcMessage } from '../hooks/useIrc';
import '../styles/IrcChat.css';

function hashColor(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) {
    hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function IrcChat() {
  const { status, messages, users, connect, disconnect, sendMessage } = useIrc();
  const [input, setInput] = useState('');
  const [showUsers, setShowUsers] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-connect on mount if disconnected
  useEffect(() => {
    if (status.state === 'disconnected') {
      connect();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      sendMessage(input.trim());
      setInput('');
      setAutoScroll(true);
    }
  };

  const statusDotClass =
    status.state === 'connected' ? 'irc-dot-connected' :
    status.state === 'connecting' ? 'irc-dot-connecting' :
    'irc-dot-disconnected';

  const renderMessage = (msg: IrcMessage) => {
    if (msg.kind === 'join' || msg.kind === 'part' || msg.kind === 'quit' || msg.kind === 'topic') {
      return (
        <div key={msg.id} className="irc-msg irc-msg-system">
          <span className="irc-msg-time">{formatTime(msg.timestamp)}</span>
          <span className="irc-msg-system-text">{msg.content}</span>
        </div>
      );
    }

    if (msg.kind === 'action') {
      return (
        <div key={msg.id} className="irc-msg irc-msg-action">
          <span className="irc-msg-time">{formatTime(msg.timestamp)}</span>
          <span className="irc-msg-action-text">
            * <span style={{ color: hashColor(msg.sender || '') }}>{msg.sender}</span> {msg.content}
          </span>
        </div>
      );
    }

    return (
      <div key={msg.id} className="irc-msg">
        <span className="irc-msg-time">{formatTime(msg.timestamp)}</span>
        <span className="irc-msg-nick" style={{ color: hashColor(msg.sender || '') }}>
          {msg.sender}
        </span>
        <span className="irc-msg-content">{msg.content}</span>
      </div>
    );
  };

  return (
    <div className="irc-chat">
      <div className="irc-header">
        <div className="irc-header-left">
          <span className={`irc-dot ${statusDotClass}`} />
          <span className="irc-channel">{status.channel}</span>
          {status.topic && <span className="irc-topic" title={status.topic}>{status.topic}</span>}
        </div>
        <div className="irc-header-right">
          <button
            className="irc-users-btn"
            onClick={() => setShowUsers(!showUsers)}
            title="Toggle user list"
          >
            {users.length} users
          </button>
          {status.state === 'connected' ? (
            <button className="irc-disconnect-btn" onClick={disconnect} title="Disconnect">
              Disconnect
            </button>
          ) : status.state === 'disconnected' || status.state === 'error' ? (
            <button className="irc-connect-btn" onClick={connect} title="Connect">
              Connect
            </button>
          ) : null}
        </div>
      </div>

      <div className="irc-body">
        <div
          className="irc-messages"
          ref={messagesContainerRef}
          onScroll={handleScroll}
        >
          {messages.length === 0 && (
            <div className="irc-empty">
              {status.state === 'connecting' ? 'Connecting to Libera.Chat...' :
               status.state === 'connected' ? `Joined ${status.channel}` :
               status.state === 'error' ? 'Connection error. Click Connect to retry.' :
               'Click Connect to join #archivist on Libera.Chat'}
            </div>
          )}
          {messages.map(renderMessage)}
          <div ref={messagesEndRef} />
        </div>

        {showUsers && (
          <div className="irc-user-list">
            <div className="irc-user-list-header">Users ({users.length})</div>
            {users.map((user) => (
              <div key={user} className="irc-user" style={{ color: hashColor(user) }}>
                {user}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="irc-input-bar">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={status.state === 'connected' ? `Message ${status.channel}...` : 'Not connected'}
          disabled={status.state !== 'connected'}
          className="irc-input"
        />
      </div>
    </div>
  );
}
