/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from '../Header';
import { useXRPL } from '../../hooks/useXRPL';

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: jest.fn().mockReturnValue({ sessionType: 'seller', role: null })
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
    useXRPL.mockReturnValue({ sessionType: 'seller', role: null });
    renderAt('/settings');
    expect(screen.getByText('cryptopay').closest('a')).toHaveAttribute('href', '/');
  });

  test('renders guest badge when session is buyer', () => {
    useXRPL.mockReturnValue({ sessionType: 'buyer', role: null });
    renderAt('/');
    expect(screen.getByText('guest')).toBeInTheDocument();
  });

  test('renders OWNER badge for admin role', () => {
    useXRPL.mockReturnValue({ sessionType: 'seller', role: 'admin' });
    renderAt('/');
    expect(screen.getByText('owner')).toBeInTheDocument();
  });

  test('renders OPERATOR badge for seller role', () => {
    useXRPL.mockReturnValue({ sessionType: 'seller', role: 'seller' });
    renderAt('/');
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  test('shows no role badge for a buyer/guest', () => {
    useXRPL.mockReturnValue({ sessionType: 'buyer', role: null });
    renderAt('/');
    expect(screen.queryByText('owner')).not.toBeInTheDocument();
    expect(screen.queryByText('operator')).not.toBeInTheDocument();
  });
});
