import React, { useState } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import { toast } from 'react-toastify';
import { encryptWalletForExport } from '../services/walletStorage';
import theme from '../theme';

const WalletContainer = styled.div`
  max-width: 420px;
  margin: 0 auto 30px;
  background: ${theme.color.paper};
  font-family: ${theme.font.stack};
`;

const Title = styled.h2`
  font-size: 22px;
  font-weight: 700;
  color: ${theme.color.ink};
  margin-bottom: 20px;
`;

const WalletInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 24px;
`;

const InfoItem = styled.div`
  background: ${theme.color.surface};
  padding: 18px 20px;
  border-radius: ${theme.radius.card};
`;

const InfoLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${theme.color.inkSoft};
  margin-bottom: 6px;
`;

const InfoValue = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${theme.color.ink};
  word-break: break-all;
`;

const StatusValue = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${p => p.$connected ? theme.color.signalDeep : theme.color.danger};
`;

const Balance = styled.div`
  font-size: 32px;
  font-weight: 700;
  color: ${theme.color.ink};
  letter-spacing: -0.02em;
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 12px;
  flex-direction: column;
`;

const Button = styled.button`
  height: 52px;
  border: none;
  border-radius: ${theme.radius.pill};
  font-size: 15px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const PrimaryButton = styled(Button)`
  background: ${theme.color.ink};
  color: ${theme.color.paper};
`;

const SecondaryButton = styled(Button)`
  background: ${theme.color.surface};
  color: ${theme.color.ink};
`;

const Wallet = () => {
  const { 
    wallet, 
    balance, 
    loading, 
    isConnected,
    createWallet, 
    refreshBalance, 
    connectToXRPL,
    askPassword
  } = useXRPL();
  
  const [isCreating, setIsCreating] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    try {
      setIsConnecting(true);
      const connected = await connectToXRPL();
      if (connected) {
        toast.success('Connected to XRPL successfully!');
      } else {
        toast.error('Failed to connect to XRPL');
      }
    } catch (error) {
      console.error('Error connecting to XRPL:', error);
      toast.error('Failed to connect to XRPL');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCreateWallet = async () => {
    try {
      setIsCreating(true);
      await createWallet();
    } catch (error) {
      console.error('Error creating wallet:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRefreshBalance = async () => {
    try {
      await refreshBalance();
      toast.success('Balance updated');
    } catch (error) {
      console.error('Error refreshing balance:', error);
    }
  };

  const handleExportWallet = async () => {
    if (!wallet) return;
    const exportPassword = await askPassword({
      title: 'Encrypt wallet export',
      description: 'Set a password for the export file.\nYou will need it to restore the wallet from the file.',
      confirmLabel: 'Export'
    });
    if (!exportPassword) {
      toast.info('Export cancelled — the wallet is only exported in encrypted form');
      return;
    }

    try {
      const walletData = await encryptWalletForExport(wallet, exportPassword);
      const dataStr = JSON.stringify(walletData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(dataBlob);
      link.download = `cryptoPay-wallet-${wallet.address}.encrypted.json`;
      link.click();
      toast.success('Encrypted wallet exported successfully');
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    }
  };

  return (
    <WalletContainer>
      <Title>Wallet & Connection</Title>
      
      <WalletInfo>
        <InfoItem>
          <InfoLabel>XRPL Connection Status</InfoLabel>
          <StatusValue $connected={isConnected}>
            {isConnected ? '✅ Connected' : '❌ Disconnected'}
          </StatusValue>
          {!isConnected && (
            <SecondaryButton 
              onClick={handleConnect}
              disabled={isConnecting}
              style={{ marginTop: '12px', height: '40px', fontSize: '13px' }}
            >
              {isConnecting ? 'Connecting...' : 'Connect to XRPL'}
            </SecondaryButton>
          )}
        </InfoItem>

        <InfoItem>
          <InfoLabel>Wallet Address</InfoLabel>
          <InfoValue>{wallet ? wallet.address : 'Not connected'}</InfoValue>
        </InfoItem>

        {wallet && (
          <InfoItem>
            <InfoLabel>On-Chain Balance</InfoLabel>
            <Balance>{balance} XRP</Balance>
          </InfoItem>
        )}
      </WalletInfo>
      
      <ActionButtons>
        {!wallet ? (
          <PrimaryButton 
            onClick={handleCreateWallet}
            disabled={loading || isCreating || !isConnected}
          >
            {isCreating ? 'Creating…' : (!isConnected ? 'Connect to XRPL First' : 'Create New Wallet')}
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton 
              onClick={handleRefreshBalance}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh Balance'}
            </PrimaryButton>
            <SecondaryButton onClick={handleExportWallet}>
              Export Wallet
            </SecondaryButton>
          </>
        )}
      </ActionButtons>
    </WalletContainer>
  );
};

export default Wallet;
