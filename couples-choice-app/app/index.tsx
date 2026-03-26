import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';
import { PrimaryButton, ScreenTitle, SurfaceCard } from '../components/ui';
import { useAppStore } from '../store/appStore';

export default function HomeScreen() {
  const { state, loading } = useAppStore();

  if (loading) return null;
  if (!state.isOnboardingComplete) return <Redirect href="/onboarding" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle
          title="Pick Us"
          subtitle={`Hi ${state.names.personA} & ${state.names.personB}. Decide in under 60 seconds.`}
        />

        <SurfaceCard>
          <Text style={styles.cardTitle}>What Should We Watch?</Text>
          <Text style={styles.cardBody}>Filter by mood and streaming services. Then keep/pass together.</Text>
          <PrimaryButton label="Start Watch Mode" onPress={() => router.push('/watch')} />
        </SurfaceCard>

        <SurfaceCard>
          <Text style={styles.cardTitle}>Where Should We Eat?</Text>
          <Text style={styles.cardBody}>Pick cuisine, vibe, distance, and find a fast mutual match.</Text>
          <PrimaryButton label="Start Eat Mode" onPress={() => router.push('/eat')} />
        </SurfaceCard>

        <View style={styles.quickRow}>
          <PrimaryButton label="Favorites" onPress={() => router.push('/favorites')} />
          <PrimaryButton label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: 80 },
  cardTitle: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
  cardBody: { marginTop: 8, color: theme.colors.subText, fontSize: 15 },
  quickRow: { marginTop: 8 }
});
