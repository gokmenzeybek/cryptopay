import React from 'react';
import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import theme from '../theme';

/**
 * TabBar — floating bottom pill navigation (UI_DESIGN §5.1).
 * Home · Activity · Settings are common to every role; Convert appears only
 * for privileged devices (seller/owner), and Admin only for owners.
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

const baseTabs = [
  { to: '/', label: 'Home' },
  { to: '/activity', label: 'Activity' },
  { to: '/settings', label: 'Settings' }
];

const TabBar = () => {
  const { role, isPrivileged } = useXRPL();
  const tabs = [
    ...baseTabs,
    ...(isPrivileged ? [{ to: '/p2p', label: 'Convert' }] : []),
    ...(role === 'admin' ? [{ to: '/admin', label: 'Admin' }] : [])
  ];

  return (
    <Bar>
      {tabs.map(tab => (
        <Tab key={tab.to} to={tab.to} end>
          {tab.label}
        </Tab>
      ))}
    </Bar>
  );
};

export default TabBar;
