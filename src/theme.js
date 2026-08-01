/**
 * CryptoPay design tokens — docs/UI_DESIGN.md §4.
 * Single source of truth for the "paper & ink, one signal" identity.
 * New components (Home/SendFlow/ConfirmSheet/UnlockModal) consume these;
 * legacy screens adopt them as they are reworked (M1–M3).
 */
const theme = {
  color: {
    paper: '#FAFAF7',
    ink: '#141414',
    inkSoft: '#6B6B66',
    inkFaint: '#9C9C95',
    surface: '#F0EFEA',
    line: '#D8D7D0',
    signal: '#00D47E',
    signalDeep: '#00A866',
    signalWash: '#E4F9EE',
    danger: '#D44747',
    dangerWash: '#FBEAEA'
  },
  font: {
    stack: `-apple-system, "SF Pro", "Segoe UI", Roboto, "Helvetica Neue", sans-serif`
  },
  radius: { card: '20px', input: '16px', pill: '32px', sheet: '24px' },
  space: (n) => `${n * 8}px`,
  motion: { fast: '120ms ease-out', med: '220ms ease-out' }
};

export default theme;
