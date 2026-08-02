/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

jest.mock('../hooks/useXRPL', () => ({
  XRPLProvider: ({ children }) => <>{children}</>,
  useXRPL: () => ({ wallet: null, apiBaseUrl: null, role: 'admin', isPrivileged: true })
}));

jest.mock('../components/Home', () => () => <div>home-page</div>);
jest.mock('../components/SendFlow', () => () => <div>send-page</div>);
jest.mock('../components/RequestFlow', () => () => <div>request-page</div>);
jest.mock('../components/P2PExchange', () => () => <div>p2p-page</div>);
jest.mock('../components/AdminConsole', () => () => <div>admin-page</div>);
jest.mock('../components/Wallet', () => () => <div>settings-page</div>);
jest.mock('../components/Dashboard', () => () => <div>dashboard-page</div>);

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

describe('App routing', () => {
  test('renders the header and Home at /', () => {
    renderAt('/');
    expect(screen.getByText('cryptopay')).toBeInTheDocument();
    expect(screen.getByText('home-page')).toBeInTheDocument();
  });

  test.each([
    ['/pay', 'send-page'],
    ['/request', 'request-page'],
    ['/p2p', 'p2p-page'],
    ['/admin', 'admin-page'],
    ['/settings', 'settings-page'],
    ['/dashboard', 'dashboard-page']
  ])('route %s renders %s', (path, marker) => {
    renderAt(path);
    expect(screen.getByText(marker)).toBeInTheDocument();
  });

  test('/payment redirects to /pay', () => {
    renderAt('/payment');
    expect(screen.getByText('send-page')).toBeInTheDocument();
  });

  test('/scanner redirects to /pay?scan=1', () => {
    renderAt('/scanner');
    expect(screen.getByText('send-page')).toBeInTheDocument();
  });
});
