import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { getNotice, subscribeNotice, registerNoticeInstance, unregisterNoticeInstance, isActiveNoticeInstance, notice } from '../services/notice';
import theme from '../theme';

/**
 * InlineNotice — renders the current notice from the shared notice store as an
 * in-flow banner (no floating toast). Auto-dismisses after a short delay and
 * offers a manual dismiss button. When several instances are mounted (app
 * shell + modal sheets), only the most recently mounted one renders so modal
 * feedback appears inside the modal.
 */
const Banner = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-radius: ${theme.radius.input};
  padding: 12px 16px;
  margin: 0 0 16px;
  font-size: 14px;
  font-family: ${theme.font.stack};
  line-height: 1.45;
  color: ${theme.color.ink};
  background: ${theme.color.surface};
  border: 1px solid ${theme.color.line};

  ${p => p.$type === 'error' && `
    background: ${theme.color.dangerWash};
    border-color: ${theme.color.danger};
    color: ${theme.color.danger};
  `}
  ${p => p.$type === 'success' && `
    background: ${theme.color.signalWash};
    border-color: ${theme.color.signal};
    color: ${theme.color.signalDeep};
  `}
`;

const Dismiss = styled.button`
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  &:hover { opacity: 1; }
`;

const InlineNotice = () => {
  const [currentNotice, setCurrentNotice] = useState(getNotice());
  const [, forceRender] = useState(0);
  const instanceId = useRef(null);

  useEffect(() => {
    instanceId.current = registerNoticeInstance();
    const unsubscribe = subscribeNotice((next) => {
      // Always track the latest notice; the `active` flag decides rendering so
      // a reactivated instance never shows stale data.
      setCurrentNotice(next);
      forceRender((v) => v + 1);
    });
    return () => {
      unsubscribe();
      unregisterNoticeInstance(instanceId.current);
    };
  }, []);

  // Re-check on every render: mounting order may change which instance is active.
  const active = instanceId.current != null && isActiveNoticeInstance(instanceId.current);

  if (!active || !currentNotice) return null;

  return (
    <Banner $type={currentNotice.type} role={currentNotice.type === 'error' ? 'alert' : 'status'}>
      <span>{currentNotice.message}</span>
      <Dismiss aria-label="Dismiss" onClick={() => notice.clear()}>×</Dismiss>
    </Banner>
  );
};

export default InlineNotice;
