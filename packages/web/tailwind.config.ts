import type { Config } from 'tailwindcss'

// Kellerkompass tokens (design system: src/styles/kellerkompass/tokens.css).
// Values point at the CSS variables so the token file stays the single source.
const v = (name: string) => `var(--${name})`

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: v('ground'),
        surface: { 1: v('surface-1'), 2: v('surface-2'), 3: v('surface-3') },
        line: v('line'),
        border: v('border'),
        ink: { DEFAULT: v('ink'), soft: v('ink-soft') },
        muted: v('muted'),
        faint: v('faint'),
        uv: { DEFAULT: v('uv'), glow: v('uv-glow'), ring: v('uv-ring'), wash: v('uv-wash') },
        'on-accent': v('on-accent'),
        warn: v('warn'),
        chrome: {
          1: v('chrome-1'),
          2: v('chrome-2'),
          3: v('chrome-3'),
          4: v('chrome-4'),
          5: v('chrome-5'),
          solid: v('chrome-solid'),
        },
      },
      backgroundImage: {
        chrome: v('chrome'),
        'chrome-dark': v('chrome-dark'),
      },
      boxShadow: {
        'glow-sm': v('glow-sm'),
        'glow-md': v('glow-md'),
        'glow-soft': v('glow-soft'),
        'glow-pin': v('glow-pin'),
        focus: v('focus-ring'),
        'mark-edge': v('mark-edge'),
      },
      fontFamily: {
        display: v('font-display'),
        sans: v('font-sans'),
        mono: v('font-mono'),
      },
      fontSize: {
        'display-xl': ['143px', { lineHeight: '0.88' }],
        'display-l': ['96px', { lineHeight: '0.88' }],
        'display-m': ['49px', { lineHeight: '1' }],
        'display-s': ['40px', { lineHeight: '1' }],
        'display-xs': ['30px', { lineHeight: '1' }],
        title: ['24px', { lineHeight: '1.2', fontWeight: '700' }],
        lede: ['18px', { lineHeight: '1.5' }],
        'body-long': ['18px', { lineHeight: '1.7' }],
        body: ['16px', { lineHeight: '1.5' }],
        time: ['16px', { lineHeight: '1.2', fontWeight: '700' }],
        ui: ['15px', { lineHeight: '1.3', fontWeight: '500' }],
        label: ['14px', { lineHeight: '1.3', fontWeight: '700' }],
        caption: ['13px', { lineHeight: '1.4' }],
        eyebrow: ['13px', { lineHeight: '1', fontWeight: '700', letterSpacing: '0.1em' }],
        code: ['15px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      spacing: {
        row: v('space-row'),
      },
      borderRadius: {
        s: v('radius-s'),
        m: v('radius-m'),
        l: v('radius-l'),
        pill: v('radius-pill'),
      },
      maxWidth: {
        content: v('content-max'),
        form: v('form-max'),
      },
      height: {
        header: v('header-h'),
      },
    },
  },
  plugins: [],
} satisfies Config
