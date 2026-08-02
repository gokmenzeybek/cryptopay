/**
 * @jest-environment jsdom
 */
jest.unmock('../../services/notice');
import { notice, getNotice, subscribeNotice, registerNoticeInstance, unregisterNoticeInstance, isActiveNoticeInstance } from '../notice';

describe('notice store', () => {
  beforeEach(() => {
    notice.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('notice.success sets the current notice and notifies subscribers', () => {
    const sub = jest.fn();
    subscribeNotice(sub);
    notice.success('Saved');
    expect(getNotice()).toEqual(expect.objectContaining({ type: 'success', message: 'Saved' }));
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'Saved' }));
  });

  test('notice.error/info/warn set the correct type', () => {
    notice.error('Bad');
    expect(getNotice().type).toBe('error');
    notice.info('Heads up');
    expect(getNotice().type).toBe('info');
    notice.warn('Careful');
    expect(getNotice().type).toBe('warn');
  });

  test('notice.clear empties the current notice', () => {
    notice.error('Bad');
    notice.clear();
    expect(getNotice()).toBeNull();
  });

  test('subscribeNotice calls the callback immediately with the current notice', () => {
    notice.info('Existing');
    const sub = jest.fn();
    subscribeNotice(sub);
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({ message: 'Existing' }));
  });

  test('unsubscribe stops further notifications', () => {
    const sub = jest.fn();
    const unsub = subscribeNotice(sub);
    unsub();
    notice.success('After');
    expect(sub).toHaveBeenCalledTimes(1);
  });

  test('auto-dismiss clears success after 4s', () => {
    notice.success('Gone soon');
    expect(getNotice()).not.toBeNull();
    jest.advanceTimersByTime(4000);
    expect(getNotice()).toBeNull();
  });

  test('auto-dismiss clears error after 6s', () => {
    notice.error('Gone later');
    jest.advanceTimersByTime(4000);
    expect(getNotice()).not.toBeNull();
    jest.advanceTimersByTime(2000);
    expect(getNotice()).toBeNull();
  });

  test('only the most recently mounted instance is active', () => {
    const a = registerNoticeInstance();
    const b = registerNoticeInstance();
    expect(isActiveNoticeInstance(a)).toBe(false);
    expect(isActiveNoticeInstance(b)).toBe(true);
    unregisterNoticeInstance(b);
    expect(isActiveNoticeInstance(a)).toBe(true);
    unregisterNoticeInstance(a);
    expect(isActiveNoticeInstance(a)).toBe(false);
  });
});
