import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TagSelector } from '../components/TagSelector';
import { SwipeDeck } from '../components/SwipeDeck';
import { GhostButton, PrimaryButton, ScreenTitle, SurfaceCard } from '../components/ui';
import { theme } from '../constants/theme';
import { moods, streamingServices, watchGenres } from '../data/options';
import { watchOptions } from '../data/watchData';
import { rankWatchOptions, shortlistFromRanked } from '../lib/matching';
import { useAppStore } from '../store/appStore';
import { WatchPreferences } from '../types/models';

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

export default function WatchScreen() {
  const { state } = useAppStore();
  const [step, setStep] = useState<'filters' | 'swipeA' | 'swipeB'>('filters');
  const [shortlistIds, setShortlistIds] = useState<string[]>([]);
  const [keptA, setKeptA] = useState<string[]>([]);

  const [prefsA, setPrefsA] = useState<WatchPreferences>(state.watchDefaults);
  const [prefsB, setPrefsB] = useState<WatchPreferences>(state.watchDefaults);

  const shortlist = useMemo(() => watchOptions.filter((w) => shortlistIds.includes(w.id)), [shortlistIds]);

  const generate = () => {
    const ranked = rankWatchOptions(watchOptions, prefsA, prefsB, state.fairness);
    setShortlistIds(shortlistFromRanked(ranked, 5).map((entry) => entry.item.id));
    setStep('swipeA');
  };

  const finalize = (keptB: string[]) => {
    const mutual = keptA.find((id) => keptB.includes(id));
    const fallback = shortlist[0]?.id;
    const chosenId = mutual || fallback;
    if (!chosenId) return;
    const reason = mutual ? 'Mutual match from both swipes.' : 'Best compromise from ranked overlap.';
    router.push({ pathname: '/recommendation', params: { mode: 'watch', itemId: chosenId, reason } });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle title="What Should We Watch?" subtitle="Pick preferences together, then swipe keep/pass." />

        {step === 'filters' && (
          <>
            <PreferencesCard
              title={`${state.names.personA}'s preferences`}
              prefs={prefsA}
              setPrefs={setPrefsA}
              runtimeLabel="Max runtime minutes"
            />
            <PreferencesCard
              title={`${state.names.personB}'s preferences`}
              prefs={prefsB}
              setPrefs={setPrefsB}
              runtimeLabel="Max runtime minutes"
            />
            <PrimaryButton label="Generate shortlist" onPress={generate} />
          </>
        )}

        {step === 'swipeA' && (
          <>
            <Text style={styles.swipeHeader}>{state.names.personA}, swipe first</Text>
            <SwipeDeck
              items={shortlist}
              onComplete={(ids) => {
                setKeptA(ids);
                setStep('swipeB');
              }}
              render={(item) => (
                <View>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.meta}>
                    {item.type} • {item.runtime} min • {item.streamingService}
                  </Text>
                  <Text style={styles.desc}>{item.description}</Text>
                </View>
              )}
            />
          </>
        )}

        {step === 'swipeB' && (
          <>
            <Text style={styles.swipeHeader}>{state.names.personB}, your turn</Text>
            <SwipeDeck
              items={shortlist}
              onComplete={finalize}
              render={(item) => (
                <View>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.meta}>
                    {item.type} • {item.runtime} min • {item.streamingService}
                  </Text>
                  <Text style={styles.desc}>{item.description}</Text>
                </View>
              )}
            />
          </>
        )}

        <GhostButton label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PreferencesCard({
  title,
  prefs,
  setPrefs,
  runtimeLabel
}: {
  title: string;
  prefs: WatchPreferences;
  setPrefs: (next: WatchPreferences) => void;
  runtimeLabel: string;
}) {
  return (
    <SurfaceCard>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.label}>Streaming Services</Text>
      <TagSelector options={streamingServices} selected={prefs.services} onToggle={(v) => setPrefs({ ...prefs, services: toggle(prefs.services, v) })} />
      <Text style={styles.label}>Genres</Text>
      <TagSelector options={watchGenres} selected={prefs.genres} onToggle={(v) => setPrefs({ ...prefs, genres: toggle(prefs.genres, v) })} />
      <Text style={styles.label}>Mood</Text>
      <TagSelector options={moods} selected={prefs.moods} onToggle={(v) => setPrefs({ ...prefs, moods: toggle(prefs.moods, v) as WatchPreferences['moods'] })} />
      <Text style={styles.label}>{runtimeLabel}</Text>
      <TextInput
        value={prefs.runtimeMax ? String(prefs.runtimeMax) : ''}
        placeholder="Any"
        keyboardType="number-pad"
        onChangeText={(value) => setPrefs({ ...prefs, runtimeMax: value ? Number(value) : undefined })}
        style={styles.input}
      />
      <View style={styles.row}>
        <GhostButton
          label={`Type: ${prefs.watchType}`}
          onPress={() =>
            setPrefs({ ...prefs, watchType: prefs.watchType === 'Either' ? 'Movie' : prefs.watchType === 'Movie' ? 'Series' : 'Either' })
          }
        />
      </View>
      <View style={styles.row}>
        <GhostButton
          label={`Newness: ${prefs.newness}`}
          onPress={() =>
            setPrefs({
              ...prefs,
              newness: prefs.newness === 'Either' ? 'New' : prefs.newness === 'New' ? 'Comfort' : 'Either'
            })
          }
        />
        <GhostButton label={prefs.surpriseMe ? 'Surprise: On' : 'Surprise: Off'} onPress={() => setPrefs({ ...prefs, surpriseMe: !prefs.surpriseMe })} />
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: 80 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginBottom: 8 },
  label: { marginTop: 10, marginBottom: 6, color: theme.colors.subText, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'white'
  },
  row: { marginTop: 8 },
  swipeHeader: { marginBottom: 8, color: theme.colors.text, fontWeight: '700', fontSize: 18 },
  title: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
  meta: { marginTop: 6, color: theme.colors.subText },
  desc: { marginTop: 10, color: theme.colors.text, lineHeight: 20 }
});
