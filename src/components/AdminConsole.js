import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import authService from '../services/authService';
import { notice } from '../services/notice';
import theme from '../theme';

/**
 * AdminConsole — owner-only dashboard (/admin). Two sections:
 *   • Disputes: list disputed orders (GET /api/moderator/disputes) and resolve
 *     each by releasing escrow to the buyer or refunding the seller.
 *   • Sellers: list all wallets with roles and promote/demote sellers.
 * Backed by the existing /api/moderator/* endpoints. Route-guarded by
 * RequireRole so only role === 'admin' can reach it.
 */
const Container = styled.div`
  max-width: 420px;
  margin: 0 auto 30px;
  font-family: ${theme.font.stack};
`;

const Title = styled.h2`
  font-size: 22px;
  font-weight: 700;
  color: ${theme.color.ink};
  margin-bottom: 20px;
`;

const Section = styled.div`
  margin-bottom: 28px;
`;

const SectionTitle = styled.h3`
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${theme.color.inkSoft};
  margin: 0 0 12px;
`;

const Card = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 16px 18px;
  margin-bottom: 12px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
`;

const OrderId = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${theme.color.ink};
  word-break: break-all;
`;

const Meta = styled.div`
  font-size: 12px;
  color: ${theme.color.inkSoft};
  line-height: 1.5;
`;

const Amount = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${theme.color.ink};
`;

const Reason = styled.div`
  font-size: 13px;
  color: ${theme.color.inkSoft};
  background: ${theme.color.paper};
  border-radius: ${theme.radius.input};
  padding: 10px 12px;
  margin: 10px 0;
  line-height: 1.45;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
`;

const Button = styled.button`
  flex: 1;
  height: 42px;
  border: none;
  border-radius: ${theme.radius.pill};
  font-size: 13px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  ${p => p.$variant === 'danger'
    ? `background: ${theme.color.danger}; color: ${theme.color.paper};`
    : `background: ${theme.color.signal}; color: #06281A;`}
`;

const Empty = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 24px;
  text-align: center;
  color: ${theme.color.inkSoft};
  font-size: 14px;
`;

const Address = styled.div`
  font-size: 13px;
  color: ${theme.color.ink};
  word-break: break-all;
  margin-bottom: 6px;
`;

const RoleTag = styled.span`
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 6px;
  ${p => p.$role === 'seller'
    ? `background: ${theme.color.signalWash}; color: ${theme.color.signalDeep};`
    : `background: ${theme.color.ink}; color: ${theme.color.paper};`}
`;

const AdminConsole = () => {
  const { apiBaseUrl } = useXRPL();
  const [disputes, setDisputes] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        authService.authFetch(`${apiBaseUrl}/api/moderator/disputes`).then(r => r.json()),
        authService.authFetch(`${apiBaseUrl}/api/moderator/sellers`).then(r => r.json())
      ]);
      if (d.success) setDisputes(d.disputes);
      if (s.success) setSellers(s.wallets);
    } catch (error) {
      console.error('Error loading admin data:', error);
      notice.error('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (apiBaseUrl) fetchAll();
  }, [apiBaseUrl]);

  const resolveDispute = async (orderId, resolution) => {
    setBusyId(orderId);
    try {
      const res = await authService.authFetch(`${apiBaseUrl}/api/moderator/resolve-dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, resolution })
      });
      const data = await res.json();
      if (data.success) {
        notice.success(data.message || 'Dispute resolved');
        fetchAll();
      } else {
        notice.error(data.message || data.error || 'Failed to resolve dispute');
      }
    } catch (error) {
      console.error('Error resolving dispute:', error);
      notice.error('Failed to resolve dispute');
    } finally {
      setBusyId(null);
    }
  };

  const setSellerRole = async (address, role) => {
    setBusyId(address);
    try {
      const res = await authService.authFetch(`${apiBaseUrl}/api/moderator/sellers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, role })
      });
      const data = await res.json();
      if (data.success) {
        notice.success(data.message || `Role set to ${role}`);
        fetchAll();
      } else {
        notice.error(data.message || data.error || 'Failed to update role');
      }
    } catch (error) {
      console.error('Error updating seller role:', error);
      notice.error('Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Container>
      <Title>Admin Console</Title>

      <Section>
        <SectionTitle>Disputes ({disputes.length})</SectionTitle>
        {disputes.length === 0 && !loading && (
          <Empty>No open disputes.</Empty>
        )}
        {disputes.map(order => (
          <Card key={order.order_id || order.id}>
            <Row>
              <OrderId>#{order.order_id || order.id}</OrderId>
              <Amount>
                {order.amount_try != null
                  ? `₺${Number(order.amount_try).toLocaleString('tr-TR')}`
                  : `${order.amount_xrp} XRP`}
              </Amount>
            </Row>
            <Meta>
              {order.order_type === 'buy' ? 'Buy' : 'Sell'} order · {order.xrpl_address}
            </Meta>
            {order.dispute_reason && <Reason>{order.dispute_reason}</Reason>}
            <ButtonRow>
              <Button
                $variant="danger"
                disabled={busyId === order.order_id || busyId === order.id}
                onClick={() => resolveDispute(order.order_id || order.id, 'refund')}
              >
                Refund seller
              </Button>
              <Button
                disabled={busyId === order.order_id || busyId === order.id}
                onClick={() => resolveDispute(order.order_id || order.id, 'release')}
              >
                Release to buyer
              </Button>
            </ButtonRow>
          </Card>
        ))}
      </Section>

      <Section>
        <SectionTitle>Sellers ({sellers.length})</SectionTitle>
        {sellers.length === 0 && !loading && (
          <Empty>No wallets registered yet.</Empty>
        )}
        {sellers.map(wallet => (
          <Card key={wallet.address}>
            <Row>
              <Address>{wallet.address}</Address>
              <RoleTag $role={wallet.role === 'seller' ? 'seller' : 'buyer'}>
                {wallet.role === 'seller' ? 'seller' : 'buyer'}
              </RoleTag>
            </Row>
            <ButtonRow>
              {wallet.role !== 'seller' ? (
                <Button
                  disabled={busyId === wallet.address}
                  onClick={() => setSellerRole(wallet.address, 'seller')}
                >
                  Promote to seller
                </Button>
              ) : (
                <Button
                  $variant="danger"
                  disabled={busyId === wallet.address}
                  onClick={() => setSellerRole(wallet.address, 'buyer')}
                >
                  Demote to buyer
                </Button>
              )}
            </ButtonRow>
          </Card>
        ))}
      </Section>
    </Container>
  );
};

export default AdminConsole;
