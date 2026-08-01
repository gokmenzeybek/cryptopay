import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import theme from '../theme';

/**
 * Header — compact wordmark + streamlined nav in the paper/ink design language.
 * Only consumer-facing essential routes (Home, Send, Request, Settings) are shown.
 */
const HeaderContainer = styled.div`
  max-width: 420px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
`;

const Wordmark = styled(Link)`
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: ${theme.color.ink};
  text-decoration: none;
  font-family: ${theme.font.stack};
`;

const Nav = styled.nav`
  display: flex;
  gap: 4px;
`;

const NavLink = styled(Link)`
  padding: 6px 12px;
  border-radius: 18px;
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  color: ${theme.color.inkSoft};
  transition: background ${theme.motion.fast}, color ${theme.motion.fast};

  &:hover {
    background: ${theme.color.surface};
    color: ${theme.color.ink};
  }

  &.active {
    background: ${theme.color.ink};
    color: ${theme.color.paper};
  }
`;

const Header = () => {
  const location = useLocation();
  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <HeaderContainer>
      <Wordmark to="/">cryptopay</Wordmark>
      <Nav>
        <NavLink to="/" className={isActive('/')}>Home</NavLink>
        <NavLink to="/pay" className={isActive('/pay')}>Send</NavLink>
        <NavLink to="/request" className={isActive('/request')}>Request</NavLink>
        <NavLink to="/settings" className={isActive('/settings')}>Wallet</NavLink>
      </Nav>
    </HeaderContainer>
  );
};

export default Header;
