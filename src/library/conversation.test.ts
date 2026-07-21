import { migrateLibraryItem } from './conversation';

test('migrates a v3 item by adding an empty conversation', () => {
  const v3 = { id: 'b1', schemaVersion: 3, savedInsights: [] } as any;
  const out = migrateLibraryItem(v3);
  expect(out.schemaVersion).toBe(4);
  expect(out.conversation).toEqual([]);
});

test('leaves an existing conversation untouched', () => {
  const v4 = { id: 'b1', schemaVersion: 4, conversation: [{ id: 't1', role: 'user', text: 'hi', createdAt: 'now' }] } as any;
  expect(migrateLibraryItem(v4).conversation).toHaveLength(1);
});

test('defaults archivedConversations to an empty array when missing', () => {
  const v4 = { id: 'b1', schemaVersion: 4, conversation: [] } as any;
  expect(migrateLibraryItem(v4).archivedConversations).toEqual([]);
});

test('leaves an existing archivedConversations array untouched', () => {
  const v4 = {
    id: 'b1',
    schemaVersion: 4,
    conversation: [],
    archivedConversations: [[{ id: 't1', role: 'user', text: 'hi', createdAt: 'now' }]],
  } as any;
  expect(migrateLibraryItem(v4).archivedConversations).toHaveLength(1);
});
