import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import { toast } from 'react-toastify';
import { useSearchParams } from 'react-router-dom';

const PaymentContainer = styled.div`
  background: #f8f9fa;
  border-radius: 15px;
  padding: 30px;
  margin-bottom: 30px;
  border-left: 5px solid #28a745;
`;

const Title = styled.h2`
  margin-bottom: 20px;
  color: #333;
`;

const FormGroup = styled.div`
  margin-bottom: 20px;
`;

const Label = styled.label`
  display: block;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
`;

const Input = styled.input`
  width: 100%;
  padding: 15px;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  font-size: 16px;
  transition: border-color 0.3s ease;
  box-sizing: border-box;
  
  &:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }
  
  &::placeholder {
    color: #999;
  }
`;

const Button = styled.button`
  padding: 15px 30px;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
  color: white;
  
  &:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(40, 167, 69, 0.4);
  }
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const LoadingSpinner = styled.div`
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #28a745;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 10px;
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const QRContainer = styled.div`
  margin-top: 20px;
  text-align: center;
  padding: 20px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
`;

const QRCode = styled.div`
  margin: 20px 0;
`;

const PaymentInfo = styled.div`
  margin-top: 15px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 10px;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  
  &:last-child {
    margin-bottom: 0;
  }
`;

const InfoLabel = styled.span`
  font-weight: 600;
  color: #333;
`;

const InfoValue = styled.span`
  color: #666;
`;

const Amount = styled.span`
  font-size: 1.5rem;
  font-weight: bold;
  color: #28a745;
`;

const Status = styled.div`
  padding: 10px;
  border-radius: 5px;
  font-weight: 600;
  text-align: center;
  margin-top: 15px;
  
  &.pending {
    background: #fff3cd;
    color: #856404;
  }
  
  &.completed {
    background: #d4edda;
    color: #155724;
  }
`;

const Payment = () => {
  const { wallet, sendPayment, loading } = useXRPL();
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({
    recipientAddress: '',
    amount: '',
    memo: ''
  });

  // Pre-fill recipient address from URL parameters
  useEffect(() => {
    const recipientFromUrl = searchParams.get('to');
    if (recipientFromUrl) {
      setFormData(prev => ({
        ...prev,
        recipientAddress: recipientFromUrl
      }));
    }
  }, [searchParams]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSendPayment = async (e) => {
    e.preventDefault();
    
    if (!wallet) {
      toast.error('No wallet available. Please create a wallet first.');
      return;
    }

    if (!formData.recipientAddress || !formData.amount) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      await sendPayment(
        formData.recipientAddress,
        parseFloat(formData.amount),
        formData.memo
      );
      
      // Clear form
      setFormData({
        recipientAddress: '',
        amount: '',
        memo: ''
      });
    } catch (error) {
      console.error('Payment failed:', error);
    }
  };


  return (
    <PaymentContainer>
      <Title>Send Payment</Title>
      
      <form onSubmit={handleSendPayment}>
        <FormGroup>
          <Label htmlFor="recipientAddress">Recipient Address</Label>
          <Input
            type="text"
            id="recipientAddress"
            name="recipientAddress"
            value={formData.recipientAddress}
            onChange={handleInputChange}
            placeholder="Enter XRPL address (starts with 'r')"
            inputMode="text"
            autoComplete="off"
            required
          />
        </FormGroup>
        
        <FormGroup>
          <Label htmlFor="amount">Amount (XRP)</Label>
          <Input
            type="number"
            id="amount"
            name="amount"
            value={formData.amount}
            onChange={handleInputChange}
            placeholder="Enter amount in XRP"
            step="0.000001"
            min="0.000001"
            inputMode="decimal"
            pattern="[0-9]*"
            autoComplete="off"
            required
          />
        </FormGroup>
        
        <FormGroup>
          <Label htmlFor="memo">Memo (Optional)</Label>
          <Input
            type="text"
            id="memo"
            name="memo"
            value={formData.memo}
            onChange={handleInputChange}
            placeholder="Enter memo for this transaction"
            inputMode="text"
            autoComplete="off"
          />
        </FormGroup>
        
        <Button type="submit" disabled={loading}>
          {loading && <LoadingSpinner />}
          Send Payment
        </Button>
      </form>

    </PaymentContainer>
  );
};

export default Payment;
