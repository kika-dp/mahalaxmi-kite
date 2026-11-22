import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/data';
import { colors, radius, space } from '@/lib/theme';

export default function Login() {
  const { signIn } = useAuth();
  const online = useOnline();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pwRef = useRef<TextInput>(null);

  const submit = async () => {
    if (!identifier.trim() || !password) return setError('Enter your username and password');
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password, remember);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.night }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
            <View style={s.hero}>
              <View style={s.logo}>
                <Ionicons name="diamond" size={40} color={colors.brand} />
              </View>
              <Text style={s.title}>Kite POS</Text>
              <Text style={s.subtitle}>Fast billing for the Uttarayan rush</Text>
            </View>
            <View style={s.card}>
              <Input
                label="Username or email"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
              />
              <View>
                <Input
                  ref={pwRef}
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!show}
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  style={{ paddingRight: 52 }}
                />
                <Pressable onPress={() => setShow((v) => !v)} style={s.eye} accessibilityLabel={show ? 'Hide password' : 'Show password'} hitSlop={8}>
                  <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.ink500} />
                </Pressable>
              </View>
              <View style={s.remember}>
                <Text style={{ fontSize: 15, color: colors.ink700 }}>Keep me signed in</Text>
                <Switch value={remember} onValueChange={setRemember} trackColor={{ true: colors.brand }} />
              </View>
              {error && (
                <Text style={s.error} accessibilityRole="alert">
                  {error}
                </Text>
              )}
              {!online && <Text style={s.error}>No internet connection.</Text>}
              <Button title="Sign in" size="lg" onPress={submit} loading={busy} disabled={!online} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  hero: { alignItems: 'center', gap: 6 },
  logo: { width: 76, height: 76, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { color: colors.white, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.65)', fontSize: 15 },
  card: { backgroundColor: colors.white, borderRadius: radius.xl, padding: space.xl, gap: space.lg },
  eye: { position: 'absolute', right: 12, bottom: 14 },
  remember: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { color: colors.red, fontSize: 15, fontWeight: '500' },
});
