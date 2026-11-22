import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { formatINR, PAYMENT_STATUS_LABELS, type InvoiceStatus, type PaymentStatus } from '@kite/shared';
import { colors, font, radius, space, TOUCH } from '@/lib/theme';
import { useOnline } from '@/lib/data';

export const money = (p: number | null | undefined, compact = false) => (p === null || p === undefined ? '—' : formatINR(p, { compact }));
export const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  size = 'md',
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'md' | 'lg' | 'xl';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const v = {
    primary: { bg: colors.brand, fg: colors.white, border: colors.brand },
    secondary: { bg: colors.white, fg: colors.ink, border: colors.ink200 },
    ghost: { bg: 'transparent', fg: colors.ink700, border: 'transparent' },
    danger: { bg: colors.red, fg: colors.white, border: colors.red },
    dark: { bg: colors.night, fg: colors.white, border: colors.night },
  }[variant];
  const h = { md: TOUCH, lg: 60, xl: 68 }[size];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: v.bg, borderColor: v.border, minHeight: h, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={size === 'md' ? 20 : 24} color={v.fg} />}
          <Text style={[styles.btnText, { color: v.fg, fontSize: size === 'md' ? 16 : 19 }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H({ children, level = 2, style }: { children: ReactNode; level?: 1 | 2 | 3; style?: StyleProp<TextStyle> }) {
  return <Text style={[level === 1 ? font.h1 : level === 2 ? font.h2 : font.h3, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[font.small, style]}>{children}</Text>;
}

export function Money({ paise, style, compact }: { paise: number | null | undefined; style?: StyleProp<TextStyle>; compact?: boolean }) {
  return <Text style={[font.money, { color: colors.ink }, style]}>{money(paise, compact)}</Text>;
}

export const Input = forwardRef<TextInputInstance, TextInputProps & { label?: string; error?: string }>(({ label, error, style, ...props }, ref) => (
  <View style={{ gap: 6 }}>
    {label && <Text style={styles.label}>{label}</Text>}
    <TextInput
      ref={ref}
      placeholderTextColor={colors.ink400}
      style={[styles.input, error ? { borderColor: colors.red } : null, style]}
      accessibilityLabel={label ?? props.placeholder}
      {...props}
    />
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>
));
Input.displayName = 'Input';

export function Chip({ label, active, onPress, tone = 'brand' }: { label: string; active?: boolean; onPress?: () => void; tone?: 'brand' | 'dark' }) {
  const bg = active ? (tone === 'dark' ? colors.night : colors.brand) : colors.white;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={[styles.chip, { backgroundColor: bg, borderColor: active ? bg : colors.ink200 }]}
    >
      <Text style={{ color: active ? colors.white : colors.ink700, fontWeight: '600', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'green' | 'red' | 'amber' | 'brand' }) {
  const t = {
    neutral: [colors.ink100, colors.ink700],
    green: [colors.greenSoft, colors.green],
    red: [colors.redSoft, colors.red],
    amber: [colors.amberSoft, colors.amber],
    brand: [colors.brandSoft, colors.brandDark],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t[0] }]}>
      <Text style={{ color: t[1], fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status, invoiceStatus }: { status: PaymentStatus; invoiceStatus?: InvoiceStatus }) {
  if (invoiceStatus === 'VOID') return <Badge label="Void" />;
  const tone = ({ PAID: 'green', PARTIALLY_PAID: 'amber', UNPAID: 'red', REFUNDED: 'neutral' } as const)[status];
  return <Badge label={PAYMENT_STATUS_LABELS[status]} tone={tone} />;
}

export function QtyStepper({ value, onChange, max }: { value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityLabel="Decrease quantity" onPress={() => (tap(), onChange(value - 1))} style={styles.stepBtn} hitSlop={6}>
        <Ionicons name={value <= 1 ? 'trash-outline' : 'remove'} size={22} color={value <= 1 ? colors.red : colors.ink} />
      </Pressable>
      <Text style={[styles.stepVal, max !== undefined && value > max ? { color: colors.red } : null]} accessibilityLabel={`Quantity ${value}`}>
        {value}
      </Text>
      <Pressable accessibilityLabel="Increase quantity" onPress={() => (tap(), onChange(value + 1))} style={styles.stepBtn} hitSlop={6}>
        <Ionicons name="add" size={22} color={colors.ink} />
      </Pressable>
    </View>
  );
}

export function NetworkBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <View style={styles.offline} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={18} color={colors.white} />
      <Text style={{ color: colors.white, fontWeight: '600' }}>Offline — bills can't be saved until the connection is back</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function PressableRow({ children, onPress, style, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: colors.ink100 }]} {...rest}>
      {children}
    </Pressable>
  );
}

export function Empty({ icon = 'file-tray-outline', title, subtitle }: { icon?: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xxl, gap: 8 }}>
      <Ionicons name={icon} size={40} color={colors.ink400} />
      <Text style={font.h3}>{title}</Text>
      {subtitle && <Text style={[font.small, { textAlign: 'center' }]}>{subtitle}</Text>}
    </View>
  );
}

export const styles = StyleSheet.create({
  btn: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.ink200 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink700 },
  input: { minHeight: TOUCH, borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 17, color: colors.ink, backgroundColor: colors.white },
  error: { color: colors.red, fontSize: 13 },
  chip: { paddingHorizontal: 16, height: 42, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.md, backgroundColor: colors.white },
  stepBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 36, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.red, paddingHorizontal: space.lg, paddingVertical: 10 },
});
