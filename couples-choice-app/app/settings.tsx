import { router } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { GhostButton, PrimaryButton, ScreenTitle, SurfaceCard } from '../components/ui';
import { theme } from '../constants/theme';
import { useAppStore } from '../store/appStore';

export default function SettingsScreen() {
  const { state, updateState, resetAll } = useAppStore();
  const [personA, setPersonA] = useState(state.names.personA);
  const [personB, setPersonB] = useState(state.names.personB);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle title="Settings" subtitle="Manage names, defaults, and data reset." />

        <SurfaceCard>
          <Text style={styles.label}>Person A name</Text>
          <TextInput style={styles.input} value={personA} onChangeText={setPersonA} />
          <Text style={styles.label}>Person B name</Text>
          <TextInput style={styles.input} value={personB} onChangeText={setPersonB} />
          <PrimaryButton label="Save names" onPress={() => updateState({ names: { personA, personB } })} />
        </SurfaceCard>

        <SurfaceCard>
          <Text style={styles.title}>Integrations (v2-ready)</Text>
          <Text style={styles.copy}>TV API connector placeholder</Text>
          <Text style={styles.copy}>Restaurant/location API connector placeholder</Text>
          <Text style={styles.copy}>Couple account sync placeholder</Text>
        </SurfaceCard>

        <GhostButton label="Reset all app data" danger onPress={() => resetAll()} />
        <GhostButton label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: 80 },
  title: { fontWeight: '700', fontSize: 18, color: theme.colors.text },
  copy: { marginTop: 8, color: theme.colors.subText },
  label: { marginBottom: 6, color: theme.colors.subText, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'white',
    marginBottom: 12
  }
});
