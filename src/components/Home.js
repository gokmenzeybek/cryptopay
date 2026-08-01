import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import AddFunds from './AddFunds';
import ActivityList from './ActivityList';
import { CameraIcon } from './icons';
import theme from '../theme';

/**
 * Home — the money screen (M1+M3, PRODUCT_PLAN §9.1 / UI_DESIGN §5.1).
 * "Your money and two buttons": balance card, Send/Request tiles, scan row,
 * receipt-style activity list. Wallet management lives in Settings.
 *
 * M3: activity list now merges /api/transactions + /api/payment_requests
 * (PRODUCT_PLAN §9.1: "last 10 items merged from both sources") — rendered
 * via the shared ActivityList component.
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

const Home = () => {
  const { wallet, balance, isConnected, apiBaseUrl, createWallet, loadExistingWallet, loading } = useXRPL();
  const navigate = useNavigate();
  const [rate, setRate] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showAddFunds, setShowAddFunds] = useState(false);

  useEffect(() => {
    if (!apiBaseUrl) return;
    fetch(`${apiBaseUrl}/api/p2p/rate`)
      .then(r => r.json())
      .then(data => { if (data.success && data.rate) setRate(parseFloat(data.rate)); })
      .catch(() => {});
  }, [apiBaseUrl]);

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
      <ActivityList />
    </Wrap>
    {showAddFunds && <AddFunds onClose={() => setShowAddFunds(false)} />}
    </>
  );
};

export default Home;

// Re-export AddFunds so it can be shallow-tested via Home tests if needed.
export { AddFunds };
