/** Design tokens for the POS (ui-ux-specification.md). Large targets, high contrast. */
export const colors = {
  brand: '#F97316',
  brandDark: '#C2410C',
  brandSoft: '#FFF7ED',
  night: '#1E1B4B',
  nightSoft: '#312E81',
  ink: '#0F172A',
  ink700: '#334155',
  ink500: '#64748B',
  ink400: '#94A3B8',
  ink200: '#E2E8F0',
  ink100: '#F1F5F9',
  bg: '#F8FAFC',
  white: '#FFFFFF',
  green: '#16A34A',
  greenSoft: '#F0FDF4',
  red: '#DC2626',
  redSoft: '#FEF2F2',
  amber: '#D97706',
  amberSoft: '#FFFBEB',
  violet: '#7C3AED',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
/** Minimum touch target (pt) — larger than Apple's 44 for shop-floor use. */
export const TOUCH = 52;

export const font = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.ink, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, color: colors.ink },
  h3: { fontSize: 17, fontWeight: '600' as const, color: colors.ink },
  body: { fontSize: 16, color: colors.ink700 },
  small: { fontSize: 13, color: colors.ink500 },
  money: { fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
};
