/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RequireRole from '../RequireRole';
import { useXRPL } from '../../hooks/useXRPL';

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: jest.fn()
}));

const Home = () => <div>Home Page</div>;
const Secret = () => <div>Secret Page</div>;

const renderAt = (path, role, isPrivileged) => {
  useXRPL.mockReturnValue({ role, isPrivileged });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path={path}
          element={<RequireRole allowed={path === '/admin' ? ['admin'] : 'privileged'}><Secret /></RequireRole>}
        />
      </Routes>
    </MemoryRouter>
  );
};

describe('RequireRole', () => {
  test('renders children when role is allowed (admin on /admin)', () => {
    renderAt('/admin', 'admin', true);
    expect(screen.getByText('Secret Page')).toBeInTheDocument();
  });

  test('redirects to Home when role is not allowed', () => {
    renderAt('/admin', 'seller', true);
    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.queryByText('Secret Page')).not.toBeInTheDocument();
  });

  test('renders children for privileged roles on /p2p', () => {
    renderAt('/p2p', 'seller', true);
    expect(screen.getByText('Secret Page')).toBeInTheDocument();
  });

  test('redirects a buyer away from /p2p', () => {
    renderAt('/p2p', 'buyer', false);
    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.queryByText('Secret Page')).not.toBeInTheDocument();
  });
});
