/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from '../Header';
import { useXRPL } from '../../hooks/useXRPL';

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: jest.fn().mockReturnValue({ sessionType: 'seller' })
}));

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter>
  );

describe('Header', () => {
  test('renders the wordmark and the settings gear', () => {
    renderAt('/');
    expect(screen.getByText('cryptopay')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });

  test('settings gear links to /settings', () => {
    renderAt('/');
    expect(screen.getByLabelText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  test('wordmark links to /', () => {
    useXRPL.mockReturnValue({ sessionType: 'seller' });
    renderAt('/settings');
    expect(screen.getByText('cryptopay').closest('a')).toHaveAttribute('href', '/');
  });

  test('renders guest badge when session is buyer', () => {
    useXRPL.mockReturnValue({ sessionType: 'buyer' });
    renderAt('/');
    expect(screen.getByText('guest')).toBeInTheDocument();
  });
});
