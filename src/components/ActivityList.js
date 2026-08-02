import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import theme from '../theme';

/**
 * ActivityList — receipt-style merged feed of transactions + payment requests
 * (UI_DESIGN §5.1, PRODUCT_PLAN §9.1). Shared by Home and the Activity screen.
 * Fetches /api/transactions + /api/payment_requests, merges, sorts newest-first,
 * and refreshes every 5s.
 */
const ActivityRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 4px;
`;

const ActivityIcon = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  ${p => {
    if (p.$request) return `background: ${theme.color.surface}; color: ${theme.color.inkSoft}; border: 1.5px solid ${theme.color.line};`;
    return p.$in
      ? `background: ${theme.color.signalWash}; color: ${theme.color.signalDeep};`
      : `background: ${theme.color.dangerWash}; color: ${theme.color.danger};`;
  }}
`;

const ActivityMain = styled.div`flex: 1; min-width: 0;`;
const ActivityTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${theme.color.ink};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const ActivitySub = styled.div`
  font-size: 12px;
  color: ${theme.color.inkSoft};
  margin-top: 2px;
`;
const ActivityRight = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
`;
const ActivityAmount = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${p => (p.$in ? theme.color.signalDeep : theme.color.ink)};
`;
const StatusChip = styled.span`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 6px;
  padding: 2px 7px;
  ${p => {
    if (p.$status === 'paid') return `background: ${theme.color.signalWash}; color: ${theme.color.signalDeep};`;
    if (p.$status === 'expired') return `background: ${theme.color.dangerWash}; color: ${theme.color.danger};`;
    return `background: ${theme.color.surface}; color: ${theme.color.inkSoft};`;
  }}
`;

const EmptyState = styled.div`
  text-align: center;
  color: ${theme.color.inkSoft};
  font-size: 14px;
  padding: 32px 0;
  line-height: 1.6;
`;

const truncate = (addr) => addr && addr.length > 14 ? `${addr.slice(0, 5)}…${addr.slice(-3)}` : (addr || '');

const ActivityList = () => {
  const { wallet, apiBaseUrl } = useXRPL();
  const [activity, setActivity] = useState([]);

  const fetchActivity = useCallback(() => {
    if (!apiBaseUrl || !wallet) return;

    const txPromise = fetch(`${apiBaseUrl}/api/transactions?address=${wallet.address}&limit=10`)
      .then(r => r.json())
      .then(data => (data.success ? (data.transactions || []).map(tx => ({ ...tx, _type: 'tx' })) : []))
      .catch(() => []);

    const reqPromise = fetch(`${apiBaseUrl}/api/payment_requests?limit=20`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) return [];
        return (data.paymentRequests || [])
          .filter(req => req.from_address === wallet.address || req.to_address === wallet.address)
          .map(req => ({ ...req, _type: 'request' }));
      })
      .catch(() => []);

    Promise.all([txPromise, reqPromise]).then(([txs, reqs]) => {
      const merged = [...txs, ...reqs]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10);
      setActivity(merged);
    });
  }, [apiBaseUrl, wallet]);

  useEffect(() => {
    fetchActivity();
    const timer = setInterval(fetchActivity, 15000);
    return () => clearInterval(timer);
  }, [fetchActivity]);

  if (activity.length === 0) {
    return (
      <EmptyState>
        No activity yet.<br />Share your address from Request to receive your first payment.
      </EmptyState>
    );
  }

  return activity.map((item) => {
    if (item._type === 'request') {
      const isRequester = item.to_address === wallet.address;
      const counterparty = isRequester ? item.from_address : item.to_address;
      return (
        <ActivityRow key={`req-${item.request_id || item.id}`}>
          <ActivityIcon $request>⬤</ActivityIcon>
          <ActivityMain>
            <ActivityTitle>
              {isRequester ? 'You requested from' : 'Request to'} {truncate(counterparty || '—')}
            </ActivityTitle>
            <ActivitySub>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</ActivitySub>
          </ActivityMain>
          <ActivityRight>
            <ActivityAmount>
              {parseFloat(item.amount_xrp || 0).toLocaleString('en-US', { maximumFractionDigits: 6 })} XRP
            </ActivityAmount>
            <StatusChip $status={item.status}>{item.status}</StatusChip>
          </ActivityRight>
        </ActivityRow>
      );
    }

    const incoming = item.to_address === wallet.address;
    const counterparty = incoming ? item.from_address : item.to_address;
    return (
      <ActivityRow key={`tx-${item.tx_hash || item.id}`}>
        <ActivityIcon $in={incoming}>{incoming ? '↓' : '↑'}</ActivityIcon>
        <ActivityMain>
          <ActivityTitle>{incoming ? 'From' : 'To'} {truncate(counterparty)}</ActivityTitle>
          <ActivitySub>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</ActivitySub>
        </ActivityMain>
        <ActivityAmount $in={incoming}>
          {incoming ? '+' : '−'}{parseFloat(item.amount_xrp || 0).toLocaleString('en-US', { maximumFractionDigits: 6 })} XRP
        </ActivityAmount>
      </ActivityRow>
    );
  });
};

export default ActivityList;
