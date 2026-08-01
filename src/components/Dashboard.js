import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import theme from '../theme';

const DashboardContainer = styled.div`
  max-width: 420px;
  margin: 0 auto 30px;
  background: ${theme.color.paper};
  font-family: ${theme.font.stack};
`;

const Title = styled.h2`
  font-size: 24px;
  font-weight: 700;
  color: ${theme.color.ink};
  margin-bottom: 20px;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
`;

const StatCard = styled.div`
  background: ${theme.color.surface};
  padding: 20px 16px;
  border-radius: ${theme.radius.card};
  text-align: center;
`;

const StatValue = styled.div`
  font-size: 26px;
  font-weight: 700;
  color: ${theme.color.ink};
  margin-bottom: 4px;
`;

const StatLabel = styled.div`
  color: ${theme.color.inkSoft};
  font-size: 13px;
  font-weight: 500;
`;

const Section = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 20px;
  margin-bottom: 20px;
`;

const SectionTitle = styled.h3`
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 14px;
  color: ${theme.color.ink};
`;

const RefreshButton = styled.button`
  padding: 12px 20px;
  border: none;
  border-radius: ${theme.radius.pill};
  background: ${theme.color.ink};
  color: ${theme.color.paper};
  font-size: 14px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  margin: 0 0 20px 0;
  transition: opacity ${theme.motion.fast};

  &:hover { opacity: 0.88; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const LoadingSpinner = styled.div`
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid ${theme.color.line};
  border-top: 2px solid ${theme.color.paper};
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 8px;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const EmptyState = styled.div`
  text-align: center;
  color: ${theme.color.inkSoft};
  padding: 20px;
  font-size: 14px;
`;

const TxRow = styled.div`
  padding: 10px 0;
  border-bottom: 1px solid ${theme.color.line};
  display: flex;
  justify-content: space-between;
  align-items: center;

  &:last-child {
    border-bottom: none;
  }
`;

const TxAmount = styled.div`
  font-weight: 700;
  color: ${theme.color.ink};
  font-size: 14px;
`;

const TxMeta = styled.div`
  font-size: 0.8rem;
  color: ${theme.color.inkSoft};
  word-break: break-all;
`;

const TxMemo = styled.div`
  font-size: 0.8rem;
  color: ${theme.color.inkFaint};
`;

const TxTime = styled.div`
  font-size: 0.8rem;
  color: ${theme.color.inkSoft};
  white-space: nowrap;
  margin-left: 8px;
`;

const StatusBadge = styled.div`
  font-size: 0.8rem;
  font-weight: 700;
  color: ${props => props.status === 'completed' ? theme.color.signalDeep : '#856404'};
  text-transform: capitalize;
`;

const Dashboard = () => {
  const { apiBaseUrl } = useXRPL();
  const [stats, setStats] = useState({
    active_wallets: 0,
    total_transactions: 0,
    total_requests: 0,
    pending_requests: 0,
    total_volume_xrp: 0,
    recent_transactions_24h: 0
  });
  const [transactions, setTransactions] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchStats = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/stats`);
      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchTransactions = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/transactions?limit=10`);
      const data = await response.json();
      if (data.success) {
        setTransactions(data.transactions || []);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const fetchPaymentRequests = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/payment_requests?limit=10`);
      const data = await response.json();
      if (data.success) {
        setPaymentRequests(data.payment_requests || []);
      }
    } catch (error) {
      console.error('Error fetching payment requests:', error);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchStats(),
        fetchTransactions(),
        fetchPaymentRequests()
      ]);
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (apiBaseUrl) {
      refreshData();
      const timer = setInterval(() => {
        fetchStats();
        fetchTransactions();
        fetchPaymentRequests();
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [apiBaseUrl]);

  return (
    <DashboardContainer>
      <Title>Dashboard</Title>

      <RefreshButton onClick={refreshData} disabled={loading}>
        {loading && <LoadingSpinner />}
        Refresh Data
      </RefreshButton>

      <StatsGrid>
        <StatCard>
          <StatValue>{stats.active_wallets}</StatValue>
          <StatLabel>Active Wallets</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{stats.total_transactions}</StatValue>
          <StatLabel>Total Transactions</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{stats.total_requests}</StatValue>
          <StatLabel>Payment Requests</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{stats.pending_requests}</StatValue>
          <StatLabel>Pending Requests</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{stats.total_volume_xrp}</StatValue>
          <StatLabel>Total Volume (XRP)</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{stats.recent_transactions_24h}</StatValue>
          <StatLabel>Recent (24h)</StatLabel>
        </StatCard>
      </StatsGrid>

      <Section>
        <SectionTitle>Recent Transactions</SectionTitle>
        {transactions.length > 0 ? (
          <div>
            {transactions.map((tx, index) => (
              <TxRow key={index}>
                <div>
                  <TxAmount>{tx.amount} XRP</TxAmount>
                  <TxMeta>
                    {tx.from_address} → {tx.to_address}
                  </TxMeta>
                  {tx.memo && (
                    <TxMemo>Memo: {tx.memo}</TxMemo>
                  )}
                </div>
                <TxTime>
                  {new Date(tx.timestamp).toLocaleString()}
                </TxTime>
              </TxRow>
            ))}
          </div>
        ) : (
          <EmptyState>No transactions yet</EmptyState>
        )}
      </Section>

      <Section>
        <SectionTitle>Recent Payment Requests</SectionTitle>
        {paymentRequests.length > 0 ? (
          <div>
            {paymentRequests.map((req, index) => (
              <TxRow key={index}>
                <div>
                  <TxAmount>{req.amount} XRP</TxAmount>
                  <TxMeta>To: {req.recipient}</TxMeta>
                  {req.memo && (
                    <TxMemo>Memo: {req.memo}</TxMemo>
                  )}
                </div>
                <div style={{ textAlign: 'right', marginLeft: '8px' }}>
                  <StatusBadge status={req.status}>
                    {req.status}
                  </StatusBadge>
                  <TxTime>
                    {new Date(req.created_at).toLocaleString()}
                  </TxTime>
                </div>
              </TxRow>
            ))}
          </div>
        ) : (
          <EmptyState>No payment requests yet</EmptyState>
        )}
      </Section>
    </DashboardContainer>
  );
};

export default Dashboard;
