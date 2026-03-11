import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface IrcMessage {
  id: string;
  timestamp: string;
  kind: 'chat' | 'join' | 'part' | 'quit' | 'topic' | 'system' | 'action';
  sender: string | null;
  content: string;
}

export interface IrcStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  nickname: string;
  channel: string;
  user_count: number;
  topic: string | null;
}

export function useIrc() {
  const [status, setStatus] = useState<IrcStatus>({
    state: 'disconnected',
    nickname: '',
    channel: '#archivist',
    user_count: 0,
    topic: null,
  });
  const [messages, setMessages] = useState<IrcMessage[]>([]);
  const [users, setUsers] = useState<string[]>([]);

  useEffect(() => {
    invoke<IrcStatus>('irc_get_status').then(setStatus).catch(console.error);
    invoke<IrcMessage[]>('irc_get_history').then(setMessages).catch(console.error);
    invoke<string[]>('irc_get_users').then(setUsers).catch(console.error);
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<IrcMessage>('irc-message', (event) => {
      setMessages((prev) => [...prev.slice(-499), event.payload]);
    }).then((fn) => unlisteners.push(fn));

    listen<{ state: string }>('irc-state-changed', (event) => {
      setStatus((prev) => ({ ...prev, state: event.payload.state as IrcStatus['state'] }));
      if (event.payload.state === 'connected') {
        invoke<string[]>('irc_get_users').then(setUsers).catch(console.error);
      }
    }).then((fn) => unlisteners.push(fn));

    listen<{ users: string[]; count: number }>('irc-users-updated', (event) => {
      setUsers(event.payload.users);
      setStatus((prev) => ({ ...prev, user_count: event.payload.count }));
    }).then((fn) => unlisteners.push(fn));

    listen<{ topic: string }>('irc-topic-changed', (event) => {
      setStatus((prev) => ({ ...prev, topic: event.payload.topic }));
    }).then((fn) => unlisteners.push(fn));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  const connect = useCallback(async () => {
    try {
      await invoke('irc_connect');
    } catch (err) {
      console.error('IRC connect failed:', err);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await invoke('irc_disconnect');
    } catch (err) {
      console.error('IRC disconnect failed:', err);
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    try {
      await invoke('irc_send_message', { message: text });
    } catch (err) {
      console.error('IRC send failed:', err);
    }
  }, []);

  return { status, messages, users, connect, disconnect, sendMessage };
}
