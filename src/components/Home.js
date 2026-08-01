import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import AddFunds from './AddFunds';
import { CameraIcon } from './icons';
import theme from '../theme';

/**
 * Home — the money screen (M1+M3, PRODUCT_PLAN §9.1 / UI_DESIGN §5.1).
 * "Your money and two buttons": balance card, Send/Request tiles, scan row,
 * receipt-style activity list. Wallet management lives in Settings.
 *
 * M3: activity list now merges /api/transactions + /api/payment_requests
 * (PRODUCT_PLAN §9.1: "last 10 items merged from both sources").
 */
const Wrap = styled.div`
  max-width: 420px;
  margin: 0 auto;
  font-family: ${theme.font.stack};
`;

const BalanceCard = styled.div`
  background: ${theme.color.ink};
  border-radius: ${theme.radius.card};
  padding: 28px 24px;
  color: ${theme.color.paper};
  position: relative;
`;

const BalanceLabel = styled.div`
  font-size: 13px;
  color: ${theme.color.inkFaint};
`;

const BalanceValue = styled.div`
  font-size: 44px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-top: 6px;
`;

const BalanceUnit = styled.span`
  font-size: 20px;
  font-weight: 500;
  color: ${theme.color.inkFaint};
`;

const FiatLine = styled.div`
  font-size: 15px;
  color: ${theme.color.inkFaint};
  margin-top: 4px;
`;

const AddFundsButton = styled.button`
  position: absolute;
  right: 20px;
  bottom: 20px;
  border: none;
  border-radius: 17px;
  background: #1F1F26;
  color: ${theme.color.signal};
  font-size: 13px;
  font-family: ${theme.font.stack};
  padding: 9px 14px;
  cursor: pointer;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 14px;
  margin-top: 24px;
`;

const ActionTile = styled.button`
  flex: 1;
  height: 96px;
  border: none;
  border-radius: ${theme.radius.card};
  text-align: left;
  padding: 18px 20px;
  cursor: pointer;
  font-family: ${theme.font.stack};
  transition: opacity ${theme.motion.fast};
  &:hover { opacity: 0.9; }
  ${p => p.$variant === 'send'
    ? `background: ${theme.color.signal}; color: #06281A;`
    : `background: ${theme.color.ink}; color: ${theme.color.paper};`}
`;

const TileArrow = styled.div`font-size: 20px;`;
const TileVerb = styled.div`
  font-size: 17px;
  font-weight: 600;
  margin-top: 10px;
`;

const ScanRow = styled.button`
  width: 100%;
  height: 56px;
  margin-top: 16px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  color: ${theme.color.ink};
  font-size: 15px;
  font-family: ${theme.font.stack};
  text-align: left;
  padding: 0 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const SectionLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${theme.color.inkSoft};
  margin: 36px 0 14px;
`;

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
  color: ${p => p.$in ? theme.color.signalDeep : theme.color.ink};
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

const SetupCard = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 28px 24px;
  text-align: center;
  margin-top: 24px;
`;

const SetupTitle = styled.div`
  font-size: 17px;
  font-weight: 600;
  color: ${theme.color.ink};
  margin-bottom: 8px;
`;

const SetupText = styled.div`
  font-size: 14px;
  color: ${theme.color.inkSoft};
  line-height: 1.5;
  margin-bottom: 20px;
`;

const SetupButton = styled.button`
  height: 52px;
  border: none;
  border-radius: ${theme.radius.pill};
  padding: 0 28px;
  font-size: 15px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  margin: 0 6px;
  ${p => p.$primary
    ? `background: ${theme.color.ink}; color: ${theme.color.paper};`
    : `background: transparent; color: ${theme.color.ink};`}
`;

const truncate = (addr) => addr && addr.length > 14 ? `${addr.slice(0, 5)}…${addr.slice(-3)}` : (addr || '');

const Home = () => {
  const { wallet, balance, isConnected, apiBaseUrl, createWallet, loadExistingWallet, loading } = useXRPL();
  const navigate = useNavigate();
  const [rate, setRate] = useState(null);
  const [activity, setActivity] = useState([]);
  const [creating, setCreating] = useState(false);
  const [showAddFunds, setShowAddFunds] = useState(false);

  useEffect(() => {
    if (!apiBaseUrl) return;
    fetch(`${apiBaseUrl}/api/p2p/rate`)
      .then(r => r.json())
      .then(data => { if (data.success && data.rate) setRate(parseFloat(data.rate)); })
      .catch(() => {});
  }, [apiBaseUrl]);

  /**
   * Fetches transactions and payment requests in parallel, merges them into a
   * single receipt-style list sorted newest-first (M3, PRODUCT_PLAN §9.1).
   */
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
        // Filter to requests involving this wallet (requester or payer)
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
    const timer = setInterval(() => {
      fetchActivity();
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchActivity]);

  const handleCreate = async () => {
    setCreating(true);
    try { await createWallet(); } catch (_) { /* toasted in hook */ }
    setCreating(false);
  };

  const numericBalance = parseFloat(balance) || 0;
  const fiatValue = rate ? numericBalance * rate : null;

  if (!wallet) {
    return (
      <Wrap>
        <BalanceCard>
          <BalanceLabel>Private payments, settled in seconds</BalanceLabel>
          <BalanceValue>0 <BalanceUnit>XRP</BalanceUnit></BalanceValue>
        </BalanceCard>
        <SetupCard>
          <SetupTitle>{isConnected ? 'Set up your wallet' : 'Connecting…'}</SetupTitle>
          <SetupText>
            One tap creates your wallet on this device. No email, no name, no signup —
            your keys never leave your phone.
          </SetupText>
          <SetupButton $primary onClick={handleCreate} disabled={!isConnected || creating || loading}>
            {creating ? 'Creating…' : 'Create my wallet'}
          </SetupButton>
          <SetupButton onClick={loadExistingWallet} disabled={!isConnected || loading}>
            Unlock saved wallet
          </SetupButton>
        </SetupCard>
      </Wrap>
    );
  }

  return (
    <>
      <Wrap>
      <BalanceCard>
        <BalanceLabel>Total balance</BalanceLabel>
        <BalanceValue>
          {numericBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })} <BalanceUnit>XRP</BalanceUnit>
        </BalanceValue>
        {fiatValue !== null && (
          <FiatLine>≈ ₺{fiatValue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</FiatLine>
        )}
        <AddFundsButton onClick={() => setShowAddFunds(true)}>+ Add funds</AddFundsButton>
      </BalanceCard>

      <ActionRow>
        <ActionTile $variant="send" onClick={() => navigate('/pay')}>
          <TileArrow>↑</TileArrow>
          <TileVerb>Send</TileVerb>
        </ActionTile>
        <ActionTile $variant="request" onClick={() => navigate('/request')}>
          <TileArrow>↓</TileArrow>
          <TileVerb>Request</TileVerb>
        </ActionTile>
      </ActionRow>

      <ScanRow onClick={() => navigate('/pay?scan=1')}>
        <CameraIcon width={18} height={18} />
        <span>Scan a QR to pay</span>
      </ScanRow>

      <SectionLabel>Activity</SectionLabel>
      {activity.length === 0 && (
        <EmptyState>
          No activity yet.<br />Share your address from Request to receive your first payment.
        </EmptyState>
      )}
      {activity.map((item) => {
        if (item._type === 'request') {
          // Payment request row — neutral ring icon + status chip
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

        // Transaction row — directional arrow icon
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
      })}
    </Wrap>
    {showAddFunds && <AddFunds onClose={() => setShowAddFunds(false)} />}
    </>
  );
};

export default Home;

// Re-export AddFunds so it can be shallow-tested via Home tests if needed.
export { AddFunds };
