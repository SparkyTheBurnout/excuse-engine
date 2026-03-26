import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { GhostButton, PrimaryButton, ScreenTitle, SurfaceCard } from '../components/ui';
import { theme } from '../constants/theme';
import { restaurantOptions } from '../data/restaurantData';
import { watchOptions } from '../data/watchData';
import { storage } from '../lib/storage';
import { useAppStore } from '../store/appStore';

export default function RecommendationScreen() {
  const params = useLocalSearchParams<{ mode: 'watch' | 'eat'; itemId: string; reason: string }>();
  const { state, addFavorite, addHistory, updateState } = useAppStore();

  const item =
    params.mode === 'watch'
      ? watchOptions.find((w) => w.id === params.itemId)
      : restaurantOptions.find((r) => r.id === params.itemId);

  if (!item) return null;

  const title = 'title' in item ? item.title : item.name;

  const saveMatch = (favorite: boolean) => {
    const record = storage.createRecord(params.mode, params.itemId, title, params.reason);
    addHistory(record);
    if (favorite) addFavorite(record);
    updateState({
      fairness: {
        ...state.fairness,
        lastWinner: 'Tie'
      }
    });
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle title="It’s a match 🎉" subtitle={params.reason} />
        <SurfaceCard>
          <Text style={styles.name}>{title}</Text>
          <Text style={styles.description}>{item.description}</Text>
        </SurfaceCard>
        <PrimaryButton label="Save to history" onPress={() => saveMatch(false)} />
        <GhostButton label="Save as favorite" onPress={() => saveMatch(true)} />
        <GhostButton label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: 80 },
  name: { fontSize: 26, fontWeight: '700', color: theme.colors.text },
  description: { marginTop: 10, fontSize: 16, color: theme.colors.subText, lineHeight: 22 }
});
