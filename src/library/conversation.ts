import type { BookSource } from '../rag/bookAskTypes';

export type ConversationTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  selectedText?: string;
  contextParagraphId?: string;
  contextTurnId?: string;
  sources?: BookSource[];
  createdAt: string;
};

export const LIBRARY_SCHEMA_VERSION = 4;

export function migrateLibraryItem<
  T extends { schemaVersion?: number; conversation?: ConversationTurn[]; archivedConversations?: ConversationTurn[][] },
>(
  item: T,
): T & { schemaVersion: number; conversation: ConversationTurn[]; archivedConversations: ConversationTurn[][] } {
  return {
    ...item,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    conversation: item.conversation ?? [],
    archivedConversations: item.archivedConversations ?? [],
  };
}
