import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TagSelector } from '../components/TagSelector';
import { SwipeDeck } from '../components/SwipeDeck';
import { GhostButton, PrimaryButton, ScreenTitle, SurfaceCard } from '../components/ui';
import { theme } from '../constants/theme';
import { cuisines, moods, priceLevels } from '../data/options';
import { restaurantOptions } from '../data/restaurantData';
import { rankRestaurantOptions, shortlistFromRanked } from '../lib/matching';
import { useAppStore } from '../store/appStore';
import { EatPreferences } from '../types/models';

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

export default function EatScreen() {
  const { state } = useAppStore();
  const [step, setStep] = useState<'filters' | 'swipeA' | 'swipeB'>('filters');
  const [shortlistIds, setShortlistIds] = useState<string[]>([]);
  const [keptA, setKeptA] = useState<string[]>([]);

  const [prefsA, setPrefsA] = useState<EatPreferences>(state.eatDefaults);
  const [prefsB, setPrefsB] = useState<EatPreferences>(state.eatDefaults);

  const shortlist = useMemo(() => restaurantOptions.filter((r) => shortlistIds.includes(r.id)), [shortlistIds]);

  const generate = () => {
    const ranked = rankRestaurantOptions(restaurantOptions, prefsA, prefsB, state.fairness);
    setShortlistIds(shortlistFromRanked(ranked, 5).map((entry) => entry.item.id));
    setStep('swipeA');
  };

  const finalize = (keptB: string[]) => {
    const mutual = keptA.find((id) => keptB.includes(id));
    const fallback = shortlist[0]?.id;
    const chosenId = mutual || fallback;
    if (!chosenId) return;
    const reason = mutual ? 'Mutual match from both swipes.' : 'Best compromise from ranked overlap.';
    router.push({ pathname: '/recommendation', params: { mode: 'eat', itemId: chosenId, reason } });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle title="Where Should We Eat?" subtitle="Set both preferences, then do quick keep/pass swipes." />

        {step === 'filters' && (
          <>
            <PreferencesCard title={`${state.names.personA}'s preferences`} prefs={prefsA} setPrefs={setPrefsA} />
            <PreferencesCard title={`${state.names.personB}'s preferences`} prefs={prefsB} setPrefs={setPrefsB} />
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
                  <Text style={styles.title}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {item.priceLevel} • {item.distanceMiles} mi • ⭐ {item.rating}
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
                  <Text style={styles.title}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {item.priceLevel} • {item.distanceMiles} mi • ⭐ {item.rating}
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
  setPrefs
}: {
  title: string;
  prefs: EatPreferences;
  setPrefs: (next: EatPreferences) => void;
}) {
  return (
    <SurfaceCard>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.label}>Cuisines</Text>
      <TagSelector options={cuisines} selected={prefs.cuisines} onToggle={(v) => setPrefs({ ...prefs, cuisines: toggle(prefs.cuisines, v) })} />
      <Text style={styles.label}>Vibe</Text>
      <TagSelector options={moods} selected={prefs.vibes} onToggle={(v) => setPrefs({ ...prefs, vibes: toggle(prefs.vibes, v) as EatPreferences['vibes'] })} />
      <Text style={styles.label}>Price level</Text>
      <TagSelector options={priceLevels} selected={prefs.priceLevels} onToggle={(v) => setPrefs({ ...prefs, priceLevels: toggle(prefs.priceLevels, v) as EatPreferences['priceLevels'] })} />
      <Text style={styles.label}>Max distance (miles)</Text>
      <TextInput
        value={String(prefs.distanceMax)}
        keyboardType="number-pad"
        onChangeText={(value) => setPrefs({ ...prefs, distanceMax: Number(value || '0') })}
        style={styles.input}
      />
      <View style={styles.row}>
        <GhostButton
          label={`Dining: ${prefs.dinePreference}`}
          onPress={() =>
            setPrefs({
              ...prefs,
              dinePreference:
                prefs.dinePreference === 'Either' ? 'Dine-In' : prefs.dinePreference === 'Dine-In' ? 'Takeout' : 'Either'
            })
          }
        />
        <GhostButton
          label={prefs.openNowOnly ? 'Open now: On' : 'Open now: Off'}
          onPress={() => setPrefs({ ...prefs, openNowOnly: !prefs.openNowOnly })}
        />
      </View>
      <GhostButton label={prefs.surpriseMe ? 'Surprise: On' : 'Surprise: Off'} onPress={() => setPrefs({ ...prefs, surpriseMe: !prefs.surpriseMe })} />
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
