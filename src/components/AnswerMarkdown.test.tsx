import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { AnswerMarkdown } from './AnswerMarkdown';

test('renders a plain paragraph unchanged', async () => {
  await render(<AnswerMarkdown text="Start early." />);
  expect(screen.getByText('Start early.')).toBeTruthy();
});

test('renders a bold span with the bold style', async () => {
  await render(<AnswerMarkdown text="**Important** note." />);
  const boldNode = screen.getByText('Important');
  const flattenedStyle = Array.isArray(boldNode.props.style)
    ? Object.assign({}, ...boldNode.props.style.filter(Boolean))
    : boldNode.props.style;
  expect(flattenedStyle.fontWeight).toBe('700');
  expect(screen.getByText(/note\./)).toBeTruthy();
});

test('renders a bullet list as separate items', async () => {
  await render(<AnswerMarkdown text={'- First item\n- Second item'} />);
  expect(screen.getAllByTestId('answer-list-item')).toHaveLength(2);
  expect(screen.getByText('First item')).toBeTruthy();
  expect(screen.getByText('Second item')).toBeTruthy();
});

test('renders a numbered list with sequential markers', async () => {
  await render(<AnswerMarkdown text={'1. Step one\n2. Step two'} />);
  expect(screen.getByText('1.')).toBeTruthy();
  expect(screen.getByText('2.')).toBeTruthy();
  expect(screen.getByText('Step one')).toBeTruthy();
  expect(screen.getByText('Step two')).toBeTruthy();
});
