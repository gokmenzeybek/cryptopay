/**
 * @jest-environment jsdom
 */
jest.unmock('../../services/notice');
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import InlineNotice from '../InlineNotice';
import { notice } from '../../services/notice';

describe('InlineNotice', () => {
  beforeEach(() => {
    notice.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders nothing when no notice is set', () => {
    render(<InlineNotice />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('renders an error notice inline with an alert role', () => {
    render(<InlineNotice />);
    act(() => { notice.error('Something went wrong'); });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  test('renders a success notice with a status role', () => {
    render(<InlineNotice />);
    act(() => { notice.success('All good'); });
    expect(screen.getByRole('status')).toHaveTextContent('All good');
  });

  test('dismiss button clears the notice', () => {
    render(<InlineNotice />);
    act(() => { notice.error('Dismiss me'); });
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('auto-dismisses after the store clears', () => {
    render(<InlineNotice />);
    act(() => { notice.success('Timed out'); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(4000); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('picks up a notice that was set before mount', () => {
    act(() => { notice.error('Pre-set'); });
    render(<InlineNotice />);
    expect(screen.getByRole('alert')).toHaveTextContent('Pre-set');
  });
});
