import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import OrderBook from './OrderBook';
import OrderForm from './OrderForm';
import OrderDetails from './OrderDetails';
import PaymentConfirmation from './PaymentConfirmation';
import XRPConfirmation from './XRPConfirmation';
import DisputeResolution from './DisputeResolution';
import authService from '../services/authService';
import theme from '../theme';

const P2PContainer = styled.div`
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
  display: flex;
  align-items: center;
  gap: 10px;
`;

const TabContainer = styled.div`
  display: flex;
  margin-bottom: 20px;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.pill};
  padding: 4px;
`;

const Tab = styled.button`
  flex: 1;
  padding: 10px 12px;
  border: none;
  background: ${props => props.active ? theme.color.ink : 'transparent'};
  color: ${props => props.active ? theme.color.paper : theme.color.inkSoft};
  border-radius: ${theme.radius.pill};
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  transition: all ${theme.motion.fast};
`;

const ContentArea = styled.div`
  background: ${theme.color.paper};
  border-radius: ${theme.radius.card};
  min-height: 400px;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
`;

const StatCard = styled.div`
  background: ${theme.color.surface};
  color: ${theme.color.ink};
  padding: 20px;
  border-radius: ${theme.radius.card};
  text-align: center;
`;

const StatValue = styled.div`
  font-size: 2rem;
  font-weight: bold;
  margin-bottom: 5px;
  color: ${theme.color.ink};
`;

const StatLabel = styled.div`
  font-size: 0.9rem;
  color: ${theme.color.inkSoft};
`;

const LoadingSpinner = styled.div`
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid ${theme.color.surface};
  border-top: 3px solid ${theme.color.signal};
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 10px;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const ErrorMessage = styled.div`
  background: ${theme.color.dangerWash};
  color: ${theme.color.danger};
  padding: 15px;
  border-radius: ${theme.radius.input};
  margin-bottom: 20px;
`;

const SuccessMessage = styled.div`
  background: ${theme.color.signalWash};
  color: ${theme.color.signalDeep};
  padding: 15px;
  border-radius: ${theme.radius.input};
  margin-bottom: 20px;
`;

const P2PExchange = () => {
  const { apiBaseUrl, wallet } = useXRPL();
  const [activeTab, setActiveTab] = useState('market');
  const [p2pStats, setP2pStats] = useState({
    total_orders: 0,
    open_orders: 0,
    matched_orders: 0,
    completed_orders: 0,
    total_volume_try: 0,
    total_volume_xrp: 0,
    avg_rate: 0,
    buy_orders: 0,
    sell_orders: 0
  });
  const [currentRate, setCurrentRate] = useState(null);
  const [orders, setOrders] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [userAddress, setUserAddress] = useState(wallet?.address || '');

  useEffect(() => {
    if (wallet?.address) {
      setUserAddress(wallet.address);
    }
  }, [wallet]);

  const tabs = [
    { id: 'market', label: 'Market' },
    { id: 'orders', label: 'Orders' },
    { id: 'my-orders', label: 'My Orders' },
    { id: 'create', label: 'Create Order' }
  ];

  const fetchP2PStats = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/p2p/stats`);
      const data = await response.json();
      if (data.success) {
        setP2pStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching P2P stats:', error);
    }
  };

  const fetchCurrentRate = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/p2p/rate`);
      const data = await response.json();
      if (data.success) {
        setCurrentRate(data);
      }
    } catch (error) {
      console.error('Error fetching current rate:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/p2p/orders?limit=50`);
      const data = await response.json();
      if (data.success) {
        setOrders(data.orders);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchMyOrders = async () => {
    if (!userAddress) return;
    try {
      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/my-orders/${userAddress}?limit=50`);
      const data = await response.json();
      if (data.success) {
        setMyOrders(data.orders);
      }
    } catch (error) {
      console.error('Error fetching my orders:', error);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchP2PStats(),
        fetchCurrentRate(),
        fetchOrders(),
        fetchMyOrders()
      ]);
    } catch (error) {
      setError('Failed to refresh data');
      console.error('Error refreshing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOrderCreated = (newOrder) => {
    setSuccess('Order created successfully!');
    refreshData();
    setActiveTab('my-orders');
  };

  const handleOrderMatched = async (orderId) => {
    try {
      const counterpartyOrder = orders.find(o => o.id === orderId);
      if (!counterpartyOrder) {
        setError('Order not found');
        return;
      }

      const ownOrder = myOrders.find(o =>
        o.status === 'open' && o.type !== counterpartyOrder.type
      );

      if (!ownOrder) {
        setError(`You need your own open ${counterpartyOrder.type === 'buy' ? 'sell' : 'buy'} order to match with this order. Create one first.`);
        return;
      }

      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: ownOrder.id,
          counterpartyOrderId: counterpartyOrder.id
        })
      });

      const result = await response.json();

      if (result.success) {
        setSuccess('Orders matched successfully!');
        refreshData();
        setSelectedOrder({ ...ownOrder, status: 'matched', counterpartyOrderId: counterpartyOrder.id });
      } else {
        setError(result.error || 'Failed to match orders');
      }
    } catch (error) {
      console.error('Error matching orders:', error);
      setError('Network error. Please try again.');
    }
  };

  const handlePaymentConfirmed = (orderId) => {
    setSuccess('Payment confirmed! Waiting for XRP transfer...');
    refreshData();
  };

  const handleXRPConfirmed = (orderId) => {
    setSuccess('Trade completed successfully!');
    refreshData();
  };

  const handleDisputeRaised = (orderId) => {
    setSuccess('Dispute raised successfully! A moderator will review it.');
    refreshData();
  };

  const handleOrderCancelled = (orderId) => {
    setSuccess('Order cancelled successfully.');
    refreshData();
  };

  const handleEscrowLocked = (orderId) => {
    setSuccess('XRP locked in escrow on the ledger.');
    refreshData();
  };

  useEffect(() => {
    if (apiBaseUrl) {
      refreshData();
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (userAddress && apiBaseUrl) {
      fetchMyOrders();
    }
  }, [userAddress, apiBaseUrl]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'market':
        return (
          <div>
            <h3>Market Overview</h3>
            {currentRate && (
              <div style={{ marginBottom: '20px', padding: '20px', background: theme.color.surface, borderRadius: theme.radius.card }}>
                <h4 style={{ color: theme.color.ink, margin: '0 0 8px' }}>Current XRP/TRY Rate</h4>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: theme.color.ink }}>
                  ₺{(Number(currentRate.rate) || 0).toFixed(2)}
                </div>
                <div style={{ color: theme.color.inkSoft, marginTop: '10px' }}>
                  Last updated: {new Date(currentRate.timestamp).toLocaleString()}
                </div>
              </div>
            )}
            <OrderBook
              orders={orders}
              onOrderSelect={setSelectedOrder}
              onOrderMatch={handleOrderMatched}
            />
          </div>
        );
      case 'orders':
        return (
          <div>
            <h3>All Orders</h3>
            <OrderBook
              orders={orders}
              onOrderSelect={setSelectedOrder}
              onOrderMatch={handleOrderMatched}
            />
          </div>
        );
      case 'my-orders':
        return (
          <div>
            <h3>My Orders</h3>
            <div style={{ marginBottom: '20px' }}>
              <input
                type="text"
                placeholder="Enter your XRPL address"
                value={userAddress}
                onChange={(e) => setUserAddress(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: 'none',
                  borderRadius: theme.radius.input,
                  background: theme.color.surface,
                  color: theme.color.ink,
                  fontFamily: theme.font.stack,
                  fontSize: '15px',
                  marginBottom: '10px',
                  outline: 'none'
                }}
              />
            </div>
            <OrderBook
              orders={myOrders}
              onOrderSelect={setSelectedOrder}
              onOrderMatch={handleOrderMatched}
              isMyOrders={true}
            />
          </div>
        );
      case 'create':
        return (
          <div>
            <h3>Create New Order</h3>
            <OrderForm
              currentRate={currentRate}
              onOrderCreated={handleOrderCreated}
              userAddress={userAddress}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <P2PContainer>
      <Title>
        P2P TRY-XRP Exchange
        <button
          onClick={refreshData}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            padding: '8px 16px',
            background: theme.color.ink,
            color: theme.color.paper,
            border: 'none',
            borderRadius: theme.radius.input,
            cursor: 'pointer',
            fontFamily: theme.font.stack,
            fontSize: '13px',
            fontWeight: 600
          }}
        >
          {loading && <LoadingSpinner />}
          Refresh
        </button>
      </Title>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {success && <SuccessMessage>{success}</SuccessMessage>}

      <StatsGrid>
        <StatCard>
          <StatValue>{p2pStats.total_orders || 0}</StatValue>
          <StatLabel>Total Orders</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{p2pStats.open_orders || 0}</StatValue>
          <StatLabel>Open Orders</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{p2pStats.completed_orders || 0}</StatValue>
          <StatLabel>Completed</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>₺{(Number(p2pStats.total_volume_try) || 0).toFixed(0)}</StatValue>
          <StatLabel>Volume TRY</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{(Number(p2pStats.total_volume_xrp) || 0).toFixed(2)}</StatValue>
          <StatLabel>Volume XRP</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>₺{(Number(p2pStats.avg_rate) || 0).toFixed(2)}</StatValue>
          <StatLabel>Avg Rate</StatLabel>
        </StatCard>
      </StatsGrid>

      <TabContainer>
        {tabs.map(tab => (
          <Tab
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Tab>
        ))}
      </TabContainer>

      <ContentArea>
        {renderTabContent()}
      </ContentArea>

      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onPaymentConfirmed={handlePaymentConfirmed}
          onXRPConfirmed={handleXRPConfirmed}
          onDisputeRaised={handleDisputeRaised}
          onCancelled={handleOrderCancelled}
          onEscrowLocked={handleEscrowLocked}
          userAddress={userAddress}
        />
      )}
    </P2PContainer>
  );
};

export default P2PExchange;
