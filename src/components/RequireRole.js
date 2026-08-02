import React from 'react';
import { Navigate } from 'react-router-dom';
import { useXRPL } from '../hooks/useXRPL';

/**
 * RequireRole — route guard for the role-adaptive UI. When the current wallet
 * role is not in `allowed`, the user is redirected to Home so buyer/guest
 * devices never see privileged screens (Convert, Admin). This keeps devices
 * dummy-proof: no denial walls, no confusion — just a redirect.
 */
const RequireRole = ({ allowed, children }) => {
  const { role, isPrivileged } = useXRPL();

  const granted = Array.isArray(allowed)
    ? allowed.includes(role)
    : allowed === 'privileged' && isPrivileged;

  if (!granted) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default RequireRole;
