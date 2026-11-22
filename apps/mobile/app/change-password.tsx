import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { changePasswordSchema } from '@kite/shared';
import { Button, Card, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, space } from '@/lib/theme';

export default function ChangePassword() {
  const { changePassword, signOut } = useAuth();
  const [v, setV] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsed = changePasswordSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await changePassword(v.currentPassword, v.newPassword);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 16, color: colors.ink700 }}>For security, choose your own password before you start billing. Use at least 10 characters with letters and numbers.</Text>
      <Card style={{ gap: space.lg }}>
        <Input label="Current password" secureTextEntry value={v.currentPassword} onChangeText={(t) => setV({ ...v, currentPassword: t })} error={errors.currentPassword} />
        <Input label="New password" secureTextEntry textContentType="newPassword" value={v.newPassword} onChangeText={(t) => setV({ ...v, newPassword: t })} error={errors.newPassword} />
        <Input label="Confirm new password" secureTextEntry value={v.confirmPassword} onChangeText={(t) => setV({ ...v, confirmPassword: t })} error={errors.confirmPassword} />
        {error && <Text style={{ color: colors.red }}>{error}</Text>}
        <Button title="Save password" size="lg" onPress={submit} loading={busy} />
      </Card>
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </ScrollView>
  );
}
