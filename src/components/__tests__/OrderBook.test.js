/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OrderBook from '../OrderBook';

const ORDERS = [
  {
    id: 1, type: 'buy', status: 'open', tryAmount: '1000', xrpAmount: '25',
    rate: '40', paymentMethods: ['papara', 'bank_transfer'],
    createdAt: '2026-01-02T00:00:00Z'
  },
  {
    id: 2, type: 'sell', status: 'matched', tryAmount: '500', xrpAmount: '10',
    rate: '50', paymentMethods: ['ininal'],
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 3, type: 'sell', status: 'completed', tryAmount: '200', xrpAmount: '5',
    rate: '40', paymentMethods: ['mefete', 'qr_havale', 'unknown_method'],
    createdAt: '2026-01-03T00:00:00Z'
  }
];

describe('OrderBook', () => {
  test('empty state for the market', () => {
    render(<OrderBook orders={[]} />);
    expect(screen.getByText('No orders found')).toBeInTheDocument();
    expect(screen.getByText(/No orders available/)).toBeInTheDocument();
  });

  test('empty state for my orders', () => {
    render(<OrderBook orders={[]} isMyOrders />);
    expect(screen.getByText(/haven't created any orders/)).toBeInTheDocument();
  });

  test('renders all orders with mapped payment method names', () => {
    render(<OrderBook orders={ORDERS} />);
    expect(screen.getByText('Papara')).toBeInTheDocument();
    expect(screen.getByText('Bank')).toBeInTheDocument();
    expect(screen.getByText('İninal')).toBeInTheDocument();
    expect(screen.getByText('Mefete')).toBeInTheDocument();
    expect(screen.getByText('QR Havale')).toBeInTheDocument();
    expect(screen.getByText('unknown_method')).toBeInTheDocument();
    expect(screen.getByText('payment confirmed'.replace('payment confirmed', 'matched'))).toBeInTheDocument();
  });

  test('filters by type and status', () => {
    render(<OrderBook orders={ORDERS} />);
    fireEvent.click(screen.getByText('Buy Orders'));
    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
    expect(screen.queryByText('₺500.00')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Completed'));
    expect(screen.getByText('₺200.00')).toBeInTheDocument();
    expect(screen.queryByText('₺1000.00')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('All Orders'));
    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
  });

  test('row click calls onOrderSelect', () => {
    const onOrderSelect = jest.fn();
    render(<OrderBook orders={ORDERS} onOrderSelect={onOrderSelect} />);
    fireEvent.click(screen.getByText('₺1000.00'));
    expect(onOrderSelect).toHaveBeenCalledWith(ORDERS[0]);
  });

  test('match button opens a confirm dialog and confirming matches', () => {
    const onOrderMatch = jest.fn();
    render(<OrderBook orders={ORDERS} onOrderMatch={onOrderMatch} />);
    fireEvent.click(screen.getByText('Match'));
    expect(screen.getByText('Match this buy order?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Match order'));
    expect(onOrderMatch).toHaveBeenCalledWith(1);
  });

  test('cancelling the confirm dialog does not match', () => {
    const onOrderMatch = jest.fn();
    render(<OrderBook orders={ORDERS} onOrderMatch={onOrderMatch} />);
    fireEvent.click(screen.getByText('Match'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onOrderMatch).not.toHaveBeenCalled();
    expect(screen.queryByText('Match this buy order?')).not.toBeInTheDocument();
  });

  test('no match buttons for my orders; View button on matched', () => {
    const onOrderSelect = jest.fn();
    render(<OrderBook orders={ORDERS} isMyOrders onOrderSelect={onOrderSelect} />);
    expect(screen.queryByText('Match')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('View'));
    expect(onOrderSelect).toHaveBeenCalledWith(ORDERS[1]);
  });

  test('handles orders with missing paymentMethods array', () => {
    render(<OrderBook orders={[{ id: 9, type: 'buy', status: 'open', tryAmount: '1', xrpAmount: '1', rate: '2', createdAt: '2026-01-01' }]} />);
    expect(screen.getByText('₺1.00')).toBeInTheDocument();
    expect(screen.getByText('₺2.00')).toBeInTheDocument();
  });

  test('renders every order status badge variant', () => {
    const statuses = ['open', 'matched', 'payment_confirmed', 'completed', 'cancelled', 'disputed', 'expired', 'some_unknown'];
    const orders = statuses.map((status, i) => ({
      id: i + 1, type: 'buy', status, tryAmount: String(100 * (i + 1)),
      xrpAmount: '1', rate: '40', paymentMethods: ['papara'], createdAt: '2026-01-01T00:00:00Z'
    }));
    render(<OrderBook orders={orders} />);
    statuses.forEach((status) => {
      expect(screen.getByText(status.replace('_', ' '))).toBeInTheDocument();
    });
  });

  test('defaults to an empty order list', () => {
    render(<OrderBook />);
    expect(screen.getByText('No orders found')).toBeInTheDocument();
  });

  test('handles orders missing id and non-numeric amount/rate', () => {
    render(<OrderBook orders={[{ type: 'buy', status: 'open', tryAmount: 'abc', rate: null, xrpAmount: '1', paymentMethods: ['papara'] }]} onOrderMatch={jest.fn()} />);
    expect(screen.getAllByText('₺0.00').length).toBe(2);
    expect(screen.getByText('Match')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Match'));
    expect(screen.getByText(/Amount: ₺0\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Rate: ₺0\.00/)).toBeInTheDocument();
  });
});
