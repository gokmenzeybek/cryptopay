/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TabBar from '../TabBar';
import { useXRPL } from '../../hooks/useXRPL';

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: jest.fn()
}));

const renderAt = (path, role = null, isPrivileged = false) => {
  useXRPL.mockReturnValue({ role, isPrivileged });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
    </MemoryRouter>
  );
};

describe('TabBar', () => {
  test('renders the base tabs for every role', () => {
    renderAt('/', null, false);
    for (const label of ['Home', 'Activity', 'Settings']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('Convert')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  test('shows Convert (no Admin) for a seller', () => {
    renderAt('/', 'seller', true);
    expect(screen.getByText('Convert')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  test('shows Convert and Admin for an admin', () => {
    renderAt('/', 'admin', true);
    expect(screen.getByText('Convert')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  test('links point at the right routes', () => {
    renderAt('/', 'admin', true);
    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Activity').closest('a')).toHaveAttribute('href', '/activity');
    expect(screen.getByText('Convert').closest('a')).toHaveAttribute('href', '/p2p');
    expect(screen.getByText('Admin').closest('a')).toHaveAttribute('href', '/admin');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  test('only Home is active on /', () => {
    renderAt('/', 'admin', true);
    expect(screen.getByText('Home').className).toContain('active');
    expect(screen.getByText('Activity').className).not.toContain('active');
    expect(screen.getByText('Settings').className).not.toContain('active');
  });

  test('only Activity is active on /activity', () => {
    renderAt('/activity', 'admin', true);
    expect(screen.getByText('Activity').className).toContain('active');
    expect(screen.getByText('Home').className).not.toContain('active');
    expect(screen.getByText('Convert').className).not.toContain('active');
  });

  test('marks the current route as active', () => {
    renderAt('/p2p', 'seller', true);
    expect(screen.getByText('Convert').className).toContain('active');
    expect(screen.getByText('Settings').className).not.toContain('active');
    expect(screen.getByText('Home').className).not.toContain('active');
  });
});
