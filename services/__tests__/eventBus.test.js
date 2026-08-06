const { EVENTS, emit, on, once, getEventTypes } = require('../eventBus');

describe('eventBus', () => {
  let unsub;

  afterEach(() => {
    if (unsub) unsub();
  });

  test('getEventTypes returns all event types', () => {
    const types = getEventTypes();
    expect(types.ORDER_CREATED).toBe('order:created');
    expect(types.ORDER_MATCHED).toBe('order:matched');
    expect(types.ORDER_COMPLETED).toBe('order:completed');
    expect(types.WALLET_BALANCE_CHANGED).toBe('wallet:balance_changed');
  });

  test('emit delivers event to subscriber', () => {
    const handler = jest.fn();
    unsub = on(EVENTS.ORDER_CREATED, handler);

    emit(EVENTS.ORDER_CREATED, { orderId: 1, amountXrp: 100 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('order:created');
    expect(handler.mock.calls[0][0].payload.orderId).toBe(1);
    expect(handler.mock.calls[0][0].timestamp).toBeDefined();
    expect(handler.mock.calls[0][0].id).toBeDefined();
  });

  test('once delivers event only once', () => {
    const handler = jest.fn();
    once(EVENTS.ORDER_MATCHED, handler);

    emit(EVENTS.ORDER_MATCHED, { orderId: 1 });
    emit(EVENTS.ORDER_MATCHED, { orderId: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload.orderId).toBe(1);
  });

  test('wildcard subscriber receives all events', () => {
    const handler = jest.fn();
    unsub = on('*', handler);

    emit(EVENTS.ORDER_CREATED, { orderId: 1 });
    emit(EVENTS.ORDER_MATCHED, { orderId: 2 });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('unsubscribe stops delivery', () => {
    const handler = jest.fn();
    unsub = on(EVENTS.ORDER_CREATED, handler);

    emit(EVENTS.ORDER_CREATED, { orderId: 1 });
    unsub();
    emit(EVENTS.ORDER_CREATED, { orderId: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('event envelope has required fields', () => {
    const handler = jest.fn();
    unsub = on(EVENTS.PAYMENT_CONFIRMED, handler);

    emit(EVENTS.PAYMENT_CONFIRMED, { orderId: 5 });

    const event = handler.mock.calls[0][0];
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('payload');
    expect(event).toHaveProperty('timestamp');
    expect(event).toHaveProperty('id');
  });

  test('warns but still emits unknown event types', () => {
    const handler = jest.fn();
    unsub = on('unknown:event', handler);

    const event = emit('unknown:event', { source: 'edge-case' });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'unknown:event',
      payload: { source: 'edge-case' },
    }));
    expect(event.type).toBe('unknown:event');
  });
});
