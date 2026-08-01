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
    renderAt('/settings');
    expect(screen.getByText('cryptopay').closest('a')).toHaveAttribute('href', '/');
  });
});
