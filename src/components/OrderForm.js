import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import authService from '../services/authService';
import theme from '../theme';

const FormContainer = styled.div`
  background: ${theme.color.paper};
  border-radius: ${theme.radius.card};
  padding: 30px;
`;

const FormTitle = styled.h3`
  margin-bottom: 20px;
  color: ${theme.color.ink};
  font-family: ${theme.font.stack};
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const FormGroup = styled.div`
  margin-bottom: 20px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: ${theme.color.inkSoft};
  font-family: ${theme.font.stack};
`;

const Input = styled.input`
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  transition: box-shadow ${theme.motion.fast};

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Select = styled.select`
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  cursor: pointer;
  transition: box-shadow ${theme.motion.fast};

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  min-height: 100px;
  resize: vertical;
  transition: box-shadow ${theme.motion.fast};

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }
`;

const CheckboxGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 10px;
`;

const CheckboxItem = styled.label`
  display: flex;
  align-items: center;
  padding: 10px;
  border: 1.5px solid ${theme.color.line};
  border-radius: ${theme.radius.input};
  cursor: pointer;
  transition: all ${theme.motion.fast};
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};

  &:hover {
    background: ${theme.color.surface};
  }

  input[type="checkbox"] {
    margin-right: 8px;
  }

  input[type="checkbox"]:checked + span {
    color: ${theme.color.signalDeep};
    font-weight: 600;
  }
`;

const Button = styled.button`
  padding: 12px 24px;
  border: none;
  border-radius: ${theme.radius.pill};
  background: ${theme.color.ink};
  color: ${theme.color.paper};
  font-size: 1rem;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  width: 100%;

  &:hover {
    opacity: 0.88;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
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

const InfoBox = styled.div`
  background: ${theme.color.signalWash};
  color: ${theme.color.signalDeep};
  padding: 15px;
  border-radius: ${theme.radius.input};
  margin-bottom: 20px;
  font-family: ${theme.font.stack};
`;

const ErrorBox = styled.div`
  background: ${theme.color.dangerWash};
  color: ${theme.color.danger};
  padding: 15px;
  border-radius: ${theme.radius.input};
  margin-bottom: 20px;
  font-family: ${theme.font.stack};
`;

const RateDisplay = styled.div`
  background: ${theme.color.surface};
  padding: 15px;
  border-radius: ${theme.radius.card};
  margin-bottom: 20px;
  text-align: center;
`;

const RateValue = styled.div`
  font-size: 1.5rem;
  font-weight: bold;
  color: ${theme.color.ink};
  margin-bottom: 5px;
`;

const RateLabel = styled.div`
  color: ${theme.color.inkSoft};
  font-size: 0.9rem;
`;

const HelperText = styled.div`
  font-size: 0.8rem;
  color: ${theme.color.inkSoft};
  margin-top: 5px;
  font-family: ${theme.font.stack};
`;

const ValidationText = styled.div`
  font-size: 0.8rem;
  margin-top: 5px;
  font-family: ${theme.font.stack};
  color: ${props => {
    if (props.$valid === true) return theme.color.signalDeep;
    if (props.$valid === false) return theme.color.danger;
    return theme.color.inkSoft;
  }};
`;

const OrderForm = ({ currentRate, onOrderCreated, userAddress }) => {
  const { apiBaseUrl } = useXRPL();
  const [formData, setFormData] = useState({
    type: 'buy',
    tryAmount: '100',
    xrpAmount: '1',
    rate: '100',
    xrplAddress: userAddress || '',
    paymentMethods: ['papara'],
    paparaAccountNumber: '',
    minAmount: '',
    maxAmount: '',
    timeLimit: '30',
    metadata: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [paymentMethodsList, setPaymentMethodsList] = useState([]);
  const [paparaValidation, setPaparaValidation] = useState({
    isValidating: false,
    isValid: null,
    accountHolder: null,
    error: null
  });

  const paparaDebounceRef = useRef(null);
  useEffect(() => {
    return () => {
      if (paparaDebounceRef.current) {
        clearTimeout(paparaDebounceRef.current);
      }
    };
  }, []);

  const orderTypes = [
    { value: 'buy', label: 'Buy XRP with TRY' },
    { value: 'sell', label: 'Sell XRP for TRY' }
  ];

  const timeLimits = [
    { value: '15', label: '15 minutes' },
    { value: '30', label: '30 minutes' },
    { value: '60', label: '1 hour' },
    { value: '120', label: '2 hours' },
    { value: '240', label: '4 hours' },
    { value: '480', label: '8 hours' }
  ];

  useEffect(() => {
    if (apiBaseUrl) {
      fetchPaymentMethods();
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (currentRate) {
      setFormData(prev => ({
        ...prev,
        rate: (currentRate.rate || 0).toFixed(2)
      }));
    }
  }, [currentRate]);

  useEffect(() => {
    if (userAddress) {
      setFormData(prev => ({
        ...prev,
        xrplAddress: userAddress
      }));
    }
  }, [userAddress]);

  const fetchPaymentMethods = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/p2p/payment-methods`);
      const data = await response.json();
      if (data.success) {
        setPaymentMethodsList(data.paymentMethods);
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
    }
  };

  const validatePaparaAccount = async (accountNumber) => {
    if (!accountNumber || accountNumber.length < 10) {
      setPaparaValidation({
        isValidating: false,
        isValid: null,
        accountHolder: null,
        error: null
      });
      return;
    }

    setPaparaValidation(prev => ({ ...prev, isValidating: true, error: null }));

    try {
      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/validate-papara-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountNumber })
      });

      const data = await response.json();

      if (data.success && data.accountExists) {
        setPaparaValidation({
          isValidating: false,
          isValid: true,
          accountHolder: data.accountHolder,
          error: null
        });
      } else {
        setPaparaValidation({
          isValidating: false,
          isValid: false,
          accountHolder: null,
          error: data.message || 'Invalid account number'
        });
      }
    } catch (error) {
      console.error('Papara validation error:', error.message);
      setPaparaValidation({
        isValidating: false,
        isValid: false,
        accountHolder: null,
        error: 'Failed to validate account'
      });
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (name === 'paparaAccountNumber') {
      if (paparaDebounceRef.current) {
        clearTimeout(paparaDebounceRef.current);
      }
      paparaDebounceRef.current = setTimeout(() => {
        validatePaparaAccount(value);
      }, 500);
    }

    if (name === 'tryAmount' && formData.rate) {
      const xrpAmount = parseFloat(value) / parseFloat(formData.rate);
      setFormData(prev => ({
        ...prev,
        xrpAmount: (xrpAmount || 0).toFixed(6)
      }));
    } else if (name === 'xrpAmount' && formData.rate) {
      const tryAmount = parseFloat(value) * parseFloat(formData.rate);
      setFormData(prev => ({
        ...prev,
        tryAmount: (tryAmount || 0).toFixed(2)
      }));
    } else if (name === 'rate') {
      if (formData.tryAmount) {
        const xrpAmount = parseFloat(formData.tryAmount) / parseFloat(value);
        setFormData(prev => ({
          ...prev,
          xrpAmount: (xrpAmount || 0).toFixed(6)
        }));
      } else if (formData.xrpAmount) {
        const tryAmount = parseFloat(formData.xrpAmount) * parseFloat(value);
        setFormData(prev => ({
          ...prev,
          tryAmount: (tryAmount || 0).toFixed(2)
        }));
      }
    }
  };

  const handlePaymentMethodChange = (method) => {
    setFormData(prev => ({
      ...prev,
      paymentMethods: prev.paymentMethods.includes(method)
        ? prev.paymentMethods.filter(m => m !== method)
        : [...prev.paymentMethods, method]
    }));
  };

  const validateForm = () => {
    if (!formData.type) {
      setError('Please select order type');
      return false;
    }
    if (!formData.tryAmount || parseFloat(formData.tryAmount) <= 0) {
      setError('Please enter a valid TRY amount');
      return false;
    }
    if (!formData.xrpAmount || parseFloat(formData.xrpAmount) <= 0) {
      setError('Please enter a valid XRP amount');
      return false;
    }
    if (!formData.rate || parseFloat(formData.rate) <= 0) {
      setError('Please enter a valid rate');
      return false;
    }
    if (!formData.xrplAddress) {
      setError('Please enter your XRPL address');
      return false;
    }

    const address = formData.xrplAddress.trim();
    if (address.length < 25 || address.length > 34) {
      setError(`XRPL address must be 25-34 characters long (current: ${address.length})`);
      return false;
    }
    if (!address.startsWith('r')) {
      setError('XRPL address must start with "r"');
      return false;
    }

    if (formData.paymentMethods.length === 0) {
      setError('Please select at least one payment method');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const orderData = {
        type: formData.type,
        tryAmount: parseFloat(formData.tryAmount),
        xrpAmount: parseFloat(formData.xrpAmount),
        rate: parseFloat(formData.rate),
        xrplAddress: formData.xrplAddress,
        paymentMethods: formData.paymentMethods,
        minAmount: formData.minAmount ? parseFloat(formData.minAmount) : null,
        maxAmount: formData.maxAmount ? parseFloat(formData.maxAmount) : null,
        timeLimit: parseInt(formData.timeLimit),
        metadata: {
          note: formData.metadata || '',
          paparaAccountNumber: formData.paparaAccountNumber || null,
          paparaAccountHolder: paparaValidation.accountHolder || null
        }
      };

      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData)
      });

      const data = await response.json();

      if (data.success) {
        onOrderCreated(data.order);
        setFormData({
          type: 'buy',
          tryAmount: '',
          xrpAmount: '',
          rate: (currentRate?.rate || 0).toFixed(2),
          xrplAddress: userAddress || '',
          paymentMethods: [],
          paparaAccountNumber: '',
          minAmount: '',
          maxAmount: '',
          timeLimit: '30',
          metadata: ''
        });
        setPaparaValidation({
          isValidating: false,
          isValid: null,
          accountHolder: null,
          error: null
        });
      } else {
        setError(data.error || 'Failed to create order');
      }
    } catch (error) {
      console.error('Error creating order:', error);
      setError(error.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormContainer>
      <FormTitle>Create New Order</FormTitle>

      {currentRate && (
        <RateDisplay>
          <RateValue>₺{(currentRate.rate || 0).toFixed(2)}</RateValue>
          <RateLabel>Current XRP/TRY Rate</RateLabel>
        </RateDisplay>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <form onSubmit={handleSubmit}>
        <FormGrid>
          <FormGroup>
            <Label>Order Type</Label>
            <Select
              name="type"
              value={formData.type}
              onChange={handleInputChange}
            >
              {orderTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label>XRPL Address</Label>
            <Input
              type="text"
              name="xrplAddress"
              value={formData.xrplAddress}
              onChange={handleInputChange}
              placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXX (25-34 characters)"
              required
            />
            <HelperText>
              Enter your XRPL address (starts with 'r', 25-34 characters)
            </HelperText>
          </FormGroup>

          <FormGroup>
            <Label>TRY Amount</Label>
            <Input
              type="number"
              name="tryAmount"
              value={formData.tryAmount}
              onChange={handleInputChange}
              placeholder="0.00"
              step="0.01"
              min="0"
              required
            />
          </FormGroup>

          <FormGroup>
            <Label>XRP Amount</Label>
            <Input
              type="number"
              name="xrpAmount"
              value={formData.xrpAmount}
              onChange={handleInputChange}
              placeholder="0.000000"
              step="0.000001"
              min="0"
              required
            />
          </FormGroup>

          <FormGroup>
            <Label>Rate (TRY per XRP)</Label>
            <Input
              type="number"
              name="rate"
              value={formData.rate}
              onChange={handleInputChange}
              placeholder="0.00"
              step="0.01"
              min="0"
              required
            />
          </FormGroup>

          <FormGroup>
            <Label>Time Limit</Label>
            <Select
              name="timeLimit"
              value={formData.timeLimit}
              onChange={handleInputChange}
            >
              {timeLimits.map(limit => (
                <option key={limit.value} value={limit.value}>
                  {limit.label}
                </option>
              ))}
            </Select>
          </FormGroup>
        </FormGrid>

        <FormGroup>
          <Label>Payment Methods</Label>
          <CheckboxGroup>
            {paymentMethodsList.map(method => (
              <CheckboxItem key={method}>
                <input
                  type="checkbox"
                  checked={formData.paymentMethods.includes(method)}
                  onChange={() => handlePaymentMethodChange(method)}
                />
                <span>{method.replace('_', ' ').toUpperCase()}</span>
              </CheckboxItem>
            ))}
          </CheckboxGroup>
        </FormGroup>

        {formData.paymentMethods.includes('papara') && (
          <FormGroup>
            <Label>Papara Account Number</Label>
            <Input
              type="text"
              name="paparaAccountNumber"
              value={formData.paparaAccountNumber}
              onChange={handleInputChange}
              placeholder="1234567890"
              maxLength="11"
              pattern="[0-9]{10,11}"
              required={formData.paymentMethods.includes('papara')}
            />
            <HelperText>
              Enter your 10-11 digit Papara account number
              {paparaValidation.isValidating && (
                <ValidationText> Validating account…</ValidationText>
              )}
              {paparaValidation.isValid === true && (
                <ValidationText $valid={true}> Account verified: {paparaValidation.accountHolder}</ValidationText>
              )}
              {paparaValidation.isValid === false && (
                <ValidationText $valid={false}> {paparaValidation.error}</ValidationText>
              )}
            </HelperText>
          </FormGroup>
        )}

        <FormGrid>
          <FormGroup>
            <Label>Minimum Amount (TRY)</Label>
            <Input
              type="number"
              name="minAmount"
              value={formData.minAmount}
              onChange={handleInputChange}
              placeholder="Optional"
              step="0.01"
              min="0"
            />
          </FormGroup>

          <FormGroup>
            <Label>Maximum Amount (TRY)</Label>
            <Input
              type="number"
              name="maxAmount"
              value={formData.maxAmount}
              onChange={handleInputChange}
              placeholder="Optional"
              step="0.01"
              min="0"
            />
          </FormGroup>
        </FormGrid>

        <FormGroup>
          <Label>Additional Notes (Optional)</Label>
          <TextArea
            name="metadata"
            value={formData.metadata}
            onChange={handleInputChange}
            placeholder="Any additional information about your order..."
          />
        </FormGroup>

        <InfoBox>
          <strong>Important:</strong> Make sure your XRPL address is correct and you have access to the selected payment methods.
          Orders will expire after the selected time limit if not matched.
        </InfoBox>

        <Button type="submit" disabled={loading}>
          {loading && <LoadingSpinner />}
          Create Order
        </Button>
      </form>
    </FormContainer>
  );
};

export default OrderForm;
