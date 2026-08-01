import React from 'react';

/**
 * CryptoPay icon set — minimal functional line SVG glyphs (UI_DESIGN §3.5:
 * "Icons are functional labels, never decoration"). Stroke-based, currentColor,
 * so they inherit the surrounding text color and theme tokens.
 */

const base = (props) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...props
});

export const CameraIcon = (props) => (
  <svg {...base(props)} aria-hidden="true">
    <path d="M3 8.5a2 2 0 0 1 2-2h1.1l1.5-2h8.8l1.5 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5z" />
    <circle cx="12" cy="13" r="3.1" />
    <path d="M7.5 6.5v-1" />
  </svg>
);

export const ClockIcon = (props) => (
  <svg {...base(props)} aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const CheckIcon = (props) => (
  <svg {...base(props)} aria-hidden="true">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const ListIcon = (props) => (
  <svg {...base(props)} aria-hidden="true">
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
);

export const ChartIcon = (props) => (
  <svg {...base(props)} aria-hidden="true">
    <path d="M4 20h16" />
    <path d="M7 16l3-5 3 3 4-7" />
    <circle cx="17" cy="7" r="1.2" />
  </svg>
);
