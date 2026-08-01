import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import theme from '../theme';

/**
 * Header — compact wordmark + settings gear in the paper/ink design language
 * (UI_DESIGN §5.1). Matches the mockup: wordmark left, a single circular gear
 * to Settings on the right. Primary navigation lives in the bottom TabBar, so
 * this row stays two elements and never overflows at any resolution.
 */
const HeaderContainer = styled.div`
  max-width: 26.25rem;
  margin: 0 auto 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.25rem;
`;

const Wordmark = styled(Link)`
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: ${theme.color.ink};
  text-decoration: none;
  font-family: ${theme.font.stack};
`;

const SettingsButton = styled(Link)`
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background: ${theme.color.surface};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  color: ${theme.color.inkSoft};
  text-decoration: none;
  transition: color ${theme.motion.fast}, background ${theme.motion.fast};

  &:hover {
    color: ${theme.color.ink};
    background: ${theme.color.line};
  }
`;

const Header = () => (
  <HeaderContainer>
    <Wordmark to="/">cryptopay</Wordmark>
    <SettingsButton to="/settings" aria-label="Settings">⚙</SettingsButton>
  </HeaderContainer>
);

export default Header;
