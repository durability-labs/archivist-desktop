// TypeScript interfaces matching Rust chat types

export interface PreKeyBundle {
  identityKey: string;
  signingKey: string;
  oneTimeKey: string | null;
  peerId: string;
}

export type DeliveryStatus = 'sending' | 'delivered' | 'read' | 'failed';

export type ConversationType = 'direct' | 'group';

export interface ChatMessageContent {
  text: string;
  replyTo: string | null;
  attachments: Attachment[];
}

export interface Attachment {
  cid: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StoredMessage {
  id: string;
  senderPeerId: string;
  content: ChatMessageContent;
  timestamp: string;
  deliveryStatus: DeliveryStatus;
  isOutgoing: boolean;
}

export interface ConversationSummary {
  id: string;
  conversationType: ConversationType;
  displayName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  members: string[] | null;
}

export interface GroupMemberInfo {
  peerId: string;
  identityKey: string;
}

export interface GroupInfo {
  groupId: string;
  groupName: string;
  creatorPeerId: string;
  members: GroupMemberInfo[];
  createdAt: string;
}

export interface ChatIdentityInfo {
  peerId: string;
  identityKey: string;
  signingKey: string;
  certFingerprint: string;
}

export interface SafetyNumberInfo {
  peerId: string;
  safetyNumber: string;
  groups: string[];
  verified: boolean;
}

export interface ChatServerStatus {
  running: boolean;
  port: number;
  totalUnread: number;
  conversationCount: number;
}
