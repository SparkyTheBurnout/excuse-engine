import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { GhostButton, ScreenTitle, SurfaceCard } from '../components/ui';
import { theme } from '../constants/theme';
import { useAppStore } from '../store/appStore';

export default function FavoritesScreen() {
  const { state, removeFavorite } = useAppStore();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle title="Favorites & History" subtitle="Your recent wins and saved picks." />

        <Text style={styles.section}>Favorites</Text>
        {state.favorites.length === 0 ? (
          <SurfaceCard>
            <Text style={styles.empty}>No favorites yet.</Text>
          </SurfaceCard>
        ) : (
          state.favorites.map((item) => (
            <SurfaceCard key={item.id}>
              <Text style={styles.title}>{item.itemTitle}</Text>
              <Text style={styles.meta}>{item.mode.toUpperCase()} • {new Date(item.matchedAt).toLocaleDateString()}</Text>
              <GhostButton label="Remove favorite" onPress={() => removeFavorite(item.id)} />
            </SurfaceCard>
          ))
        )}

        <Text style={styles.section}>Recent history</Text>
        {state.history.slice(0, 10).map((item) => (
          <SurfaceCard key={item.id}>
            <Text style={styles.title}>{item.itemTitle}</Text>
            <Text style={styles.meta}>{item.reason}</Text>
          </SurfaceCard>
        ))}

        <GhostButton label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: 80 },
  section: { fontWeight: '700', fontSize: 18, color: theme.colors.text, marginBottom: 8 },
  empty: { color: theme.colors.subText },
  title: { fontWeight: '700', fontSize: 18, color: theme.colors.text },
  meta: { marginTop: 4, color: theme.colors.subText }
});
