export type BackgroundJobKind = 'indexing' | 'mindmap';
export type BackgroundJobResultStatus = 'ready' | 'failed';

export type PersistedPendingNotice = {
  kind: BackgroundJobKind;
  status: BackgroundJobResultStatus;
  notifiedAt: string;
};

export type SelectedPendingNotice = {
  bookId: string;
  bookTitle: string;
  kind: BackgroundJobKind;
  status: BackgroundJobResultStatus;
};

export function selectPendingNotice(
  libraryItems: Array<{
    id: string;
    book: { title: string };
    pendingNotice?: PersistedPendingNotice;
  }>,
): SelectedPendingNotice | null {
  const withNotice = libraryItems.filter(
    (item): item is typeof item & { pendingNotice: PersistedPendingNotice } =>
      item.pendingNotice !== undefined,
  );

  if (withNotice.length === 0) {
    return null;
  }

  const oldest = withNotice.reduce((earliest, item) =>
    item.pendingNotice.notifiedAt < earliest.pendingNotice.notifiedAt ? item : earliest,
  );

  return {
    bookId: oldest.id,
    bookTitle: oldest.book.title,
    kind: oldest.pendingNotice.kind,
    status: oldest.pendingNotice.status,
  };
}
