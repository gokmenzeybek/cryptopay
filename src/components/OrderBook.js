import React, { useState, memo } from 'react';
import styled from 'styled-components';
import ConfirmDialog from './ConfirmDialog';
import { ListIcon } from './icons';
import theme from '../theme';

const OrderBookContainer = styled.div`
  background: ${theme.color.paper};
  border-radius: ${theme.radius.card};
  overflow: hidden;
`;

const OrderBookHeader = styled.div`
  background: ${theme.color.surface};
  padding: 15px 20px;
  border-bottom: 1px solid ${theme.color.line};
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr;
  gap: 10px;
  font-weight: 600;
  color: ${theme.color.inkSoft};
  font-size: 0.9rem;
`;

const OrderBookBody = styled.div`
  max-height: 400px;
  overflow-y: auto;
`;

const OrderRow = styled.div`
  padding: 15px 20px;
  border-bottom: 1px solid ${theme.color.line};
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr;
  gap: 10px;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background: ${theme.color.surface};
  }

  &:last-child {
    border-bottom: none;
  }
`;

const OrderType = styled.span`
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  background: ${props => props.type === 'buy' ? theme.color.signalWash : theme.color.dangerWash};
  color: ${props => props.type === 'buy' ? theme.color.signalDeep : theme.color.danger};
`;

const OrderStatus = styled.span`
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  background: ${props => {
    switch (props.status) {
      case 'open': return theme.color.surface;
      case 'matched': return '#FFF8E1';
      case 'payment_confirmed': return theme.color.signalWash;
      case 'completed': return theme.color.signalWash;
      case 'cancelled': return theme.color.dangerWash;
      case 'disputed': return theme.color.dangerWash;
      case 'expired': return theme.color.surface;
      default: return theme.color.surface;
    }
  }};
  color: ${props => {
    switch (props.status) {
      case 'open': return theme.color.inkSoft;
      case 'matched': return '#856404';
      case 'payment_confirmed': return theme.color.signalDeep;
      case 'completed': return theme.color.signalDeep;
      case 'cancelled': return theme.color.danger;
      case 'disputed': return theme.color.danger;
      case 'expired': return theme.color.inkFaint;
      default: return theme.color.inkSoft;
    }
  }};
`;

const Amount = styled.span`
  font-weight: 600;
  color: ${theme.color.ink};
`;

const Rate = styled.span`
  font-weight: 600;
  color: ${theme.color.ink};
`;

const Address = styled.span`
  font-family: monospace;
  font-size: 0.8rem;
  color: ${theme.color.inkSoft};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PaymentMethods = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const PaymentMethodTag = styled.span`
  padding: 2px 6px;
  background: ${theme.color.surface};
  border-radius: 4px;
  font-size: 0.7rem;
  color: ${theme.color.inkSoft};
`;

const ActionButton = styled.button`
  padding: 6px 12px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.ink};
  color: ${theme.color.paper};
  font-size: 0.8rem;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};

  &:hover {
    opacity: 0.88;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: ${theme.color.inkSoft};
`;

const FilterContainer = styled.div`
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
`;

const FilterButton = styled.button`
  padding: 8px 16px;
  border: 1px solid ${theme.color.line};
  background: ${props => props.active ? theme.color.ink : theme.color.paper};
  color: ${props => props.active ? theme.color.paper : theme.color.inkSoft};
  border-radius: ${theme.radius.input};
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  font-family: ${theme.font.stack};
  transition: all ${theme.motion.fast};

  &:hover {
    background: ${props => props.active ? theme.color.ink : theme.color.surface};
  }
`;

const OrderBook = ({
  orders = [],
  onOrderSelect,
  onOrderMatch,
  isMyOrders = false
}) => {
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [matchCandidate, setMatchCandidate] = useState(null);

  const filters = [
    { id: 'all', label: 'All Orders' },
    { id: 'buy', label: 'Buy Orders' },
    { id: 'sell', label: 'Sell Orders' },
    { id: 'open', label: 'Open' },
    { id: 'matched', label: 'Matched' },
    { id: 'completed', label: 'Completed' }
  ];

  const filteredOrders = orders.filter(order => {
    if (filter === 'all') return true;
    if (filter === 'buy' || filter === 'sell') return order.type === filter;
    return order.status === filter;
  });

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    let aValue, bValue;

    switch (sortBy) {
      case 'rate':
        aValue = parseFloat(a.rate);
        bValue = parseFloat(b.rate);
        break;
      case 'amount':
        aValue = parseFloat(a.tryAmount);
        bValue = parseFloat(b.tryAmount);
        break;
      case 'createdAt':
        aValue = new Date(a.createdAt);
        bValue = new Date(b.createdAt);
        break;
      default:
        aValue = a[sortBy];
        bValue = b[sortBy];
    }

    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  const handleOrderClick = (order) => {
    if (onOrderSelect) {
      onOrderSelect(order);
    }
  };

  const handleMatchOrder = (order, e) => {
    e.stopPropagation();
    if (onOrderMatch) {
      setMatchCandidate(order);
    }
  };

  const canMatchOrder = (order) => {
    return order.status === 'open' && !isMyOrders;
  };

  const formatPaymentMethods = (methods) => {
    if (!methods || !Array.isArray(methods)) return [];
    return methods.map(method => {
      const methodNames = {
        'bank_transfer': 'Bank',
        'papara': 'Papara',
        'ininal': 'İninal',
        'mefete': 'Mefete',
        'qr_havale': 'QR Havale'
      };
      return methodNames[method] || method;
    });
  };

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (orders.length === 0) {
    return (
      <OrderBookContainer>
        <EmptyState>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px', color: theme.color.inkFaint }}>
            <ListIcon width={28} height={28} />
          </div>
          <div>No orders found</div>
          <div style={{ fontSize: '0.9rem', marginTop: '5px', color: theme.color.inkFaint }}>
            {isMyOrders ? 'You haven\'t created any orders yet' : 'No orders available in the market'}
          </div>
        </EmptyState>
      </OrderBookContainer>
    );
  }

  return (
    <>
      <OrderBookContainer>
        <FilterContainer>
          {filters.map(filterOption => (
            <FilterButton
              key={filterOption.id}
              active={filter === filterOption.id}
              onClick={() => setFilter(filterOption.id)}
            >
              {filterOption.label}
            </FilterButton>
          ))}
        </FilterContainer>

        <OrderBookHeader>
          <div>Type</div>
          <div>Status</div>
          <div>Amount (TRY)</div>
          <div>Rate</div>
          <div>Payment Methods</div>
          <div>Actions</div>
        </OrderBookHeader>

        <OrderBookBody>
          {sortedOrders.map((order, index) => (
            <OrderRow key={order.id || index} onClick={() => handleOrderClick(order)}>
              <div>
                <OrderType type={order.type}>
                  {order.type}
                </OrderType>
              </div>
              <div>
                <OrderStatus status={order.status}>
                  {order.status.replace('_', ' ')}
                </OrderStatus>
              </div>
              <div>
                <Amount>₺{(parseFloat(order.tryAmount) || 0).toFixed(2)}</Amount>
              </div>
              <div>
                <Rate>₺{(parseFloat(order.rate) || 0).toFixed(2)}</Rate>
              </div>
              <div>
                <PaymentMethods>
                  {formatPaymentMethods(order.paymentMethods).map((method, idx) => (
                    <PaymentMethodTag key={idx}>{method}</PaymentMethodTag>
                  ))}
                </PaymentMethods>
              </div>
              <div>
                {canMatchOrder(order) && (
                  <ActionButton onClick={(e) => handleMatchOrder(order, e)}>
                    Match
                  </ActionButton>
                )}
                {order.status === 'matched' && (
                  <ActionButton onClick={() => handleOrderClick(order)}>
                    View
                  </ActionButton>
                )}
              </div>
            </OrderRow>
          ))}
        </OrderBookBody>
      </OrderBookContainer>

      {matchCandidate && (
        <ConfirmDialog
          title={`Match this ${matchCandidate.type} order?`}
          description={
            `Amount: ₺${(parseFloat(matchCandidate.tryAmount) || 0).toFixed(2)} for ${matchCandidate.xrpAmount} XRP\n` +
            `Rate: ₺${(parseFloat(matchCandidate.rate) || 0).toFixed(2)} TRY/XRP\n` +
            `Payment methods: ${formatPaymentMethods(matchCandidate.paymentMethods).join(', ')}\n\n` +
            `After matching, you'll be taken to the payment screen.`
          }
          confirmLabel="Match order"
          onSubmit={() => {
            onOrderMatch(matchCandidate.id);
            setMatchCandidate(null);
          }}
          onCancel={() => setMatchCandidate(null)}
        />
      )}
    </>
  );
};

export default memo(OrderBook);
