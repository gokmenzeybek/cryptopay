/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from '../Header';

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter>
  );

describe('Header', () => {
  test('renders the wordmark and essential consumer nav links', () => {
    renderAt('/');
    expect(screen.getByText('cryptopay')).toBeInTheDocument();
    for (const label of ['Home', 'Send', 'Request', 'Wallet']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test('marks the current route as active', () => {
    renderAt('/settings');
    expect(screen.getByText('Wallet').className).toContain('active');
    expect(screen.getByText('Home').className).not.toContain('active');
  });

  test('marks Send active on /pay', () => {
    renderAt('/pay');
    expect(screen.getByText('Send').className).toContain('active');
  });

  test('links point at the right routes', () => {
    renderAt('/');
    expect(screen.getByText('Request').closest('a')).toHaveAttribute('href', '/request');
    expect(screen.getByText('Wallet').closest('a')).toHaveAttribute('href', '/settings');
  });
});
