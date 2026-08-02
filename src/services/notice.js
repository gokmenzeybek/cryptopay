/**
 * notice — module-level replacement for react-toastify.
 *
 * Instead of floating popup toasts, messages are stored here and rendered
 * INLINE by one or more <InlineNotice/> components subscribed to this store.
 * Multiple InlineNotice instances may be mounted (app shell + modal sheets);
 * only the most recently mounted instance renders, so a message fired while a
 * modal is open appears inside the modal, not behind its overlay.
 *
 * API mirrors toast.* for a mechanical migration:
 *   notice.success(message)  notice.error(message)
 *   notice.info(message)     notice.warn(message)   notice.clear()
 */

let current = null;
let subscribers = [];
let sequence = 0;

// Stack of mounted InlineNotice instances (ids). The last id is "active".
let mounted = [];

function emit() {
  subscribers.forEach((cb) => cb(current));
}

function setNext(type, message) {
  current = message == null ? null : { type, message, id: ++sequence };
  emit();
  if (current) {
    clearTimeout(setNext._timer);
    setNext._timer = setTimeout(() => setNext(null, null), current.type === 'error' ? 6000 : 4000);
  }
}

export const notice = {
  success: (message) => setNext('success', message),
  error: (message) => setNext('error', message),
  info: (message) => setNext('info', message),
  warn: (message) => setNext('warn', message),
  clear: () => setNext(null, null)
};

// Returns the current notice (or null).
export const getNotice = () => current;

// Subscribe to notice changes. Returns an unsubscribe function.
export const subscribeNotice = (cb) => {
  subscribers.push(cb);
  cb(current);
  return () => {
    subscribers = subscribers.filter((s) => s !== cb);
  };
};

// Registers a mounted InlineNotice instance; returns its id.
export const registerNoticeInstance = () => {
  const id = ++sequence;
  mounted.push(id);
  // Notify subscribers so previously-active instances re-render their `active` flag.
  subscribers.forEach((cb) => cb(current));
  return id;
};

// Unregisters a mounted InlineNotice instance.
export const unregisterNoticeInstance = (id) => {
  mounted = mounted.filter((m) => m !== id);
  // Notify subscribers so the next-topmost instance becomes active again.
  subscribers.forEach((cb) => cb(current));
};

// True when the given instance is the most recently mounted one.
export const isActiveNoticeInstance = (id) => mounted.length > 0 && mounted[mounted.length - 1] === id;
