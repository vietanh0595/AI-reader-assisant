import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BookSources } from './BookSources';
import type { BookSource } from '../rag/bookAskTypes';

function makeSource(overrides: Partial<BookSource> = {}): BookSource {
  return {
    id: 'src-1',
    excerpt: 'Monetary policy raises interest rates.',
    paragraphId: 'p40',
    sourceRef: { source: 'epub' },
    ...overrides,
  };
}

test('renders nothing when sources list is empty', async () => {
  await render(<BookSources sources={[]} onNavigate={jest.fn()} />);
  expect(screen.queryByTestId('book-sources-container')).toBeNull();
});

test('renders source chips for each source', async () => {
  const sources = [
    makeSource({ id: 'src-1', excerpt: 'First excerpt.' }),
    makeSource({ id: 'src-2', excerpt: 'Second excerpt.' }),
  ];
  await render(<BookSources sources={sources} onNavigate={jest.fn()} />);
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

test('calls onNavigate with paragraphId and excerpt when chip is pressed', async () => {
  const onNavigate = jest.fn();
  const source = makeSource({ paragraphId: 'p99', excerpt: 'Monetary policy raises interest rates.' });
  await render(<BookSources sources={[source]} onNavigate={onNavigate} />);
  fireEvent.press(screen.getAllByRole('button')[0]);
  expect(onNavigate).toHaveBeenCalledWith('p99', 'Monetary policy raises interest rates.');
});

test('shows chapter title when available', async () => {
  const source = makeSource({ chapterTitle: 'Chapter 3' });
  await render(<BookSources sources={[source]} onNavigate={jest.fn()} />);
  expect(screen.getByText(/Chapter 3/)).toBeTruthy();
});

test('derives a page label from pageIndex', async () => {
  const source = makeSource({ pageIndex: 174 });
  await render(<BookSources sources={[source]} onNavigate={jest.fn()} />);
  expect(screen.getByText('Page 175')).toBeTruthy();
});

// The ask API sends null, not an omitted key, for an EPUB answer's page fields.
test('shows no page label when pageIndex and pageLabel arrive as null', async () => {
  const source = makeSource({ pageIndex: null, pageLabel: null } as unknown as Partial<BookSource>);
  await render(<BookSources sources={[source]} onNavigate={jest.fn()} />);
  expect(screen.queryByText(/^Page /)).toBeNull();
});

test('prefers an explicit pageLabel even without a pageIndex', async () => {
  const source = makeSource({ pageLabel: 'xii' });
  await render(<BookSources sources={[source]} onNavigate={jest.fn()} />);
  expect(screen.getByText('xii')).toBeTruthy();
});

test('shows excerpt text', async () => {
  const source = makeSource({ excerpt: 'Unique excerpt text here.' });
  await render(<BookSources sources={[source]} onNavigate={jest.fn()} />);
  expect(screen.getByText(/Unique excerpt text here\./)).toBeTruthy();
});
