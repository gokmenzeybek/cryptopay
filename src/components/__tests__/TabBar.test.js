/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TabBar from '../TabBar';

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
    </MemoryRouter>
  );

describe('TabBar', () => {
  test('renders the four reference tabs', () => {
    renderAt('/');
    for (const label of ['Home', 'Activity', 'Convert', 'Settings']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test('links point at the right routes', () => {
    renderAt('/');
    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Activity').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Convert').closest('a')).toHaveAttribute('href', '/p2p');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  test('marks the current route as active', () => {
    renderAt('/p2p');
    expect(screen.getByText('Convert').className).toContain('active');
    expect(screen.getByText('Settings').className).not.toContain('active');
    expect(screen.getByText('Home').className).not.toContain('active');
  });
});
