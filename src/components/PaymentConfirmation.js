import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import authService from '../services/authService';
import theme from '../theme';

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 20, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1500;
  @media (min-width: 640px) { align-items: center; }
`;

const ModalContent = styled.div`
  background: ${theme.color.paper};
  width: 100%;
  max-width: 420px;
  border-radius: ${theme.radius.sheet} ${theme.radius.sheet} 0 0;
  max-height: 90vh;
  overflow-y: auto;
  @media (min-width: 640px) { border-radius: ${theme.radius.sheet}; }
`;

const ModalHeader = styled.div`
  padding: 20px 24px;
  border-bottom: 1px solid ${theme.color.line};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ModalTitle = styled.h3`
  margin: 0;
  color: ${theme.color.ink};
  font-family: ${theme.font.stack};
  font-size: 18px;
  font-weight: 700;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: ${theme.color.inkSoft};
  &:hover { color: ${theme.color.ink}; }
`;

const ModalBody = styled.div`
  padding: 24px;
`;

const FormGroup = styled.div`
  margin-bottom: 20px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: ${theme.color.inkSoft};
  font-size: 14px;
`;

const Input = styled.input`
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  transition: box-shadow ${theme.motion.fast};
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }

  &::placeholder {
    color: ${theme.color.inkFaint};
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  min-height: 100px;
  resize: vertical;
  transition: box-shadow ${theme.motion.fast};
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }

  &::placeholder {
    color: ${theme.color.inkFaint};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-wrap: wrap;
`;

const ActionButton = styled.button`
  padding: 12px 20px;
  border: none;
  border-radius: ${theme.radius.pill};
  font-size: 14px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  flex: 1;
  min-width: 120px;

  &:hover { opacity: 0.88; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const PrimaryBtn = styled(ActionButton)`
  background: ${theme.color.ink};
  color: ${theme.color.paper};
`;

const SuccessBtn = styled(ActionButton)`
  background: ${theme.color.signal};
  color: #06281A;
`;

const SecondaryBtn = styled(ActionButton)`
  background: ${theme.color.surface};
  color: ${theme.color.ink};
`;

const LoadingSpinner = styled.div`
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid ${theme.color.line};
  border-top: 2px solid ${theme.color.signal};
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 8px;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const InfoBox = styled.div`
  background: ${theme.color.signalWash};
  color: ${theme.color.signalDeep};
  padding: 14px 16px;
  border-radius: ${theme.radius.card};
  margin-bottom: 20px;
  font-size: 14px;
  line-height: 1.5;
`;

const ErrorBox = styled.div`
  background: ${theme.color.dangerWash};
  color: ${theme.color.danger};
  padding: 14px 16px;
  border-radius: ${theme.radius.card};
  margin-bottom: 20px;
  font-size: 14px;
`;

const OrderSummary = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 20px;
  margin-bottom: 20px;
`;

const SummaryRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid ${theme.color.line};

  &:last-child {
    border-bottom: none;
  }
  font-size: 14px;
`;

const SummaryLabel = styled.span`
  font-weight: 600;
  color: ${theme.color.inkSoft};
`;

const SummaryValue = styled.span`
  color: ${theme.color.ink};
  font-weight: 600;
`;

const PaparaStatusBox = styled.div`
  padding: 20px;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  margin-bottom: 20px;
`;

const PaparaStatusTitle = styled.h4`
  margin: 0 0 10px 0;
  color: ${props => props.status === 'completed' ? theme.color.signalDeep : props.status === 'failed' ? theme.color.danger : theme.color.ink};
  font-size: 16px;
  font-weight: 700;
`;

const PaparaStatusText = styled.p`
  margin: 0 0 8px 0;
  font-size: 14px;
  color: ${theme.color.inkSoft};

  strong {
    color: ${theme.color.ink};
  }
`;

const StatusDot = styled.span`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  background: ${props =>
    props.status === 'completed' ? theme.color.signal :
    props.status === 'failed' ? theme.color.danger :
    '#ffc107'};
`;

const PaymentConfirmation = ({ order, onClose, onConfirmed }) => {
  const { apiBaseUrl } = useXRPL();
  const [formData, setFormData] = useState({
    proofOfPayment: '',
    paymentReference: '',
    additionalNotes: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [paparaPayment, setPaparaPayment] = useState({
    initiated: false,
    transactionId: null,
    status: null,
    polling: false
  });

  const pollTimersRef = useRef(null);
  useEffect(() => {
    return () => {
      const timers = pollTimersRef.current;
      if (timers) {
        if (timers.interval) clearInterval(timers.interval);
        if (timers.timeout) clearTimeout(timers.timeout);
      }
    };
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const initiatePaparaPayment = async () => {
    setLoading(true);
    setError(null);

    try {
      const paparaAccountNumber = order.metadata?.paparaAccountNumber;

      if (!paparaAccountNumber) {
        setError('Papara account number not found in order');
        return;
      }

      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/initiate-papara-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          paparaAccountNumber: paparaAccountNumber
        })
      });

      const data = await response.json();

      if (data.success) {
        setPaparaPayment({
          initiated: true,
          transactionId: data.transactionId,
          status: data.status,
          polling: true
        });
        startStatusPolling(data.transactionId);
      } else {
        setError(data.error || 'Failed to initiate Papara payment');
      }
    } catch (error) {
      setError('Network error. Please try again.');
      console.error('Error initiating Papara payment:', error);
    } finally {
      setLoading(false);
    }
  };

  const startStatusPolling = (transactionId) => {
    if (!pollTimersRef.current) {
      pollTimersRef.current = { interval: null, timeout: null };
    }
    const pollInterval = setInterval(async () => {
      try {
        const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/papara-payment-status/${order.id}`);
        const data = await response.json();

        if (data.success) {
          setPaparaPayment(prev => ({
            ...prev,
            status: data.status
          }));

          if (data.status === 'completed') {
            clearInterval(pollInterval);
            setPaparaPayment(prev => ({ ...prev, polling: false }));
            onConfirmed(order.id);
          } else if (data.status === 'failed') {
            clearInterval(pollInterval);
            setPaparaPayment(prev => ({ ...prev, polling: false }));
            setError('Payment failed');
          }
        }
      } catch (error) {
        console.error('Error polling payment status:', error);
      }
    }, 5000);

    const pollTimeout = setTimeout(() => {
      clearInterval(pollInterval);
      setPaparaPayment(prev => ({ ...prev, polling: false }));
    }, 600000);

    pollTimersRef.current.interval = pollInterval;
    pollTimersRef.current.timeout = pollTimeout;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!formData.proofOfPayment.trim()) {
      setError('Please provide proof of payment');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          proofOfPayment: formData.proofOfPayment,
          paymentReference: formData.paymentReference,
          additionalNotes: formData.additionalNotes
        })
      });

      const data = await response.json();

      if (data.success) {
        onConfirmed(order.id);
      } else {
        setError(data.error || 'Failed to confirm payment');
      }
    } catch (error) {
      setError('Network error. Please try again.');
      console.error('Error confirming payment:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPaymentMethods = (methods) => {
    if (!methods || !Array.isArray(methods)) return [];
    return methods.map(method => {
      const methodNames = {
        'bank_transfer': 'Bank Transfer',
        'papara': 'Papara',
        'ininal': 'İninal',
        'mefete': 'Mefete',
        'qr_havale': 'QR Havale'
      };
      return methodNames[method] || method;
    });
  };

  const isPaparaOrder = () => {
    return order.paymentMethods && order.paymentMethods.includes('papara') &&
           order.metadata && order.metadata.paparaAccountNumber;
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>Confirm TRY Payment</ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>

        <ModalBody>
          <OrderSummary>
            <SummaryRow>
              <SummaryLabel>Order ID:</SummaryLabel>
              <SummaryValue>{order.id}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Amount to Pay:</SummaryLabel>
              <SummaryValue>₺{(parseFloat(order.tryAmount) || 0).toFixed(2)}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>XRP Amount:</SummaryLabel>
              <SummaryValue>{(parseFloat(order.xrpAmount) || 0).toFixed(6)} XRP</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Rate:</SummaryLabel>
              <SummaryValue>₺{(parseFloat(order.rate) || 0).toFixed(2)} per XRP</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Payment Methods:</SummaryLabel>
              <SummaryValue>
                {formatPaymentMethods(order.paymentMethods).join(', ')}
              </SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Seller Address:</SummaryLabel>
              <SummaryValue style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {order.counterpartyAddress || 'N/A'}
              </SummaryValue>
            </SummaryRow>
          </OrderSummary>

          {isPaparaOrder() ? (
            <>
              <InfoBox>
                <strong>Papara Instant Transfer:</strong> This order uses Papara for instant transfer.
                Click the button below to initiate the payment automatically.
              </InfoBox>

              {paparaPayment.initiated ? (
                <PaparaStatusBox>
                  <PaparaStatusTitle status={paparaPayment.status}>Payment Initiated</PaparaStatusTitle>
                  <PaparaStatusText>
                    <strong>Transaction ID:</strong> {paparaPayment.transactionId}
                  </PaparaStatusText>
                  <PaparaStatusText>
                    <strong>Status:</strong>
                    <StatusDot status={paparaPayment.status} />
                    {paparaPayment.status === 'completed' ? 'Completed' :
                     paparaPayment.status === 'failed' ? 'Failed' :
                     paparaPayment.status === 'pending' ? 'Pending' : paparaPayment.status}
                  </PaparaStatusText>
                  {paparaPayment.polling && (
                    <PaparaStatusText style={{ fontSize: '0.85rem' }}>
                      Checking payment status…
                    </PaparaStatusText>
                  )}
                </PaparaStatusBox>
              ) : (
                <PaparaStatusBox>
                  <PaparaStatusTitle>Ready to Pay</PaparaStatusTitle>
                  <PaparaStatusText>
                    <strong>Amount:</strong> ₺{(parseFloat(order.tryAmount) || 0).toFixed(2)}
                  </PaparaStatusText>
                  <PaparaStatusText>
                    <strong>Recipient:</strong> {order.metadata?.paparaAccountHolder || 'Papara Account'}
                  </PaparaStatusText>
                  <PaparaStatusText style={{ fontSize: '0.85rem' }}>
                    The payment will be processed instantly once initiated.
                  </PaparaStatusText>
                </PaparaStatusBox>
              )}

              {error && <ErrorBox>{error}</ErrorBox>}

              <ButtonRow>
                <SecondaryBtn
                  type="button"
                  onClick={onClose}
                  disabled={loading || paparaPayment.polling}
                >
                  Cancel
                </SecondaryBtn>
                {!paparaPayment.initiated && (
                  <SuccessBtn
                    type="button"
                    onClick={initiatePaparaPayment}
                    disabled={loading}
                  >
                    {loading && <LoadingSpinner />}
                    Initiate Papara Transfer
                  </SuccessBtn>
                )}
              </ButtonRow>
            </>
          ) : (
            <>
              <InfoBox>
                <strong>Important:</strong> Only confirm payment after you have successfully transferred the TRY amount
                to the seller using one of the agreed payment methods. Make sure to include the payment reference
                if provided by the seller.
              </InfoBox>

              {error && <ErrorBox>{error}</ErrorBox>}

              <form onSubmit={handleSubmit}>
                <FormGroup>
                  <Label>Proof of Payment *</Label>
                  <TextArea
                    name="proofOfPayment"
                    value={formData.proofOfPayment}
                    onChange={handleInputChange}
                    placeholder="Please provide proof of payment (transaction ID, screenshot, receipt, etc.)"
                    required
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Payment Reference</Label>
                  <Input
                    type="text"
                    name="paymentReference"
                    value={formData.paymentReference}
                    onChange={handleInputChange}
                    placeholder="Payment reference number (if provided by seller)"
                  />
                </FormGroup>

                <FormGroup>
                  <Label>Additional Notes</Label>
                  <TextArea
                    name="additionalNotes"
                    value={formData.additionalNotes}
                    onChange={handleInputChange}
                    placeholder="Any additional information about the payment..."
                  />
                </FormGroup>

                <ButtonRow>
                  <SecondaryBtn
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                  >
                    Cancel
                  </SecondaryBtn>
                  <SuccessBtn
                    type="submit"
                    disabled={loading}
                  >
                    {loading && <LoadingSpinner />}
                    Confirm Payment
                  </SuccessBtn>
                </ButtonRow>
              </form>
            </>
          )}
        </ModalBody>
      </ModalContent>
    </ModalOverlay>
  );
};

export default PaymentConfirmation;
