import React from 'react';
import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import theme from '../theme';

/**
 * TabBar — floating bottom pill navigation (UI_DESIGN §5.1).
 * Matches the mockup: four items (Home · Activity · Convert · Settings),
 * active = ink/600, inactive = inkSoft. Activity is its own destination
 * (/activity), so the Home and Activity tabs highlight independently.
 */
const Bar = styled.nav`
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(26.25rem, calc(100vw - 2rem));
  height: 3.25rem;
  border-radius: 1.625rem;
  background: ${theme.color.surface};
  display: flex;
  align-items: center;
  padding: 0 0.5rem;
  z-index: 50;
`;

const Tab = styled(NavLink)`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 2.75rem;
  border-radius: 1.375rem;
  text-decoration: none;
  font-size: 0.8125rem;
  font-family: ${theme.font.stack};
  color: ${theme.color.inkSoft};
  transition: color ${theme.motion.fast}, background ${theme.motion.fast};

  &.active {
    background: ${theme.color.ink};
    color: ${theme.color.paper};
    font-weight: 600;
  }
`;

const tabs = [
  { to: '/', label: 'Home' },
  { to: '/activity', label: 'Activity' },
  { to: '/p2p', label: 'Convert' },
  { to: '/settings', label: 'Settings' }
];

const TabBar = () => (
  <Bar>
    {tabs.map(tab => (
      <Tab key={tab.label} to={tab.to} end>
        {tab.label}
      </Tab>
    ))}
  </Bar>
);

export default TabBar;
