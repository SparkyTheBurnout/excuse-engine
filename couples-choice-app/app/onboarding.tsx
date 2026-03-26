import { router } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { theme } from '../constants/theme';
import { GhostButton, PrimaryButton, ScreenTitle, SurfaceCard } from '../components/ui';
import { useAppStore } from '../store/appStore';

export default function OnboardingScreen() {
  const { state, updateState } = useAppStore();
  const [step, setStep] = useState(0);
  const [personA, setPersonA] = useState(state.names.personA);
  const [personB, setPersonB] = useState(state.names.personB);
  const [watchInterest, setWatchInterest] = useState(true);
  const [eatInterest, setEatInterest] = useState(true);

  const finish = () => {
    updateState({
      isOnboardingComplete: true,
      names: { personA: personA || 'You', personB: personB || 'Partner' },
      watchDefaults: { ...state.watchDefaults, surpriseMe: !watchInterest ? true : state.watchDefaults.surpriseMe },
      eatDefaults: { ...state.eatDefaults, surpriseMe: !eatInterest ? true : state.eatDefaults.surpriseMe }
    });
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle title="Welcome to Pick Us" subtitle="A faster, lighter way to choose together." />

        {step === 0 && (
          <SurfaceCard>
            <Text style={styles.header}>No more 30-minute debates.</Text>
            <Text style={styles.copy}>Pick Us helps couples choose watch and food plans in a shared flow.</Text>
            <PrimaryButton label="Continue" onPress={() => setStep(1)} />
          </SurfaceCard>
        )}

        {step === 1 && (
          <SurfaceCard>
            <Text style={styles.header}>What do you want help deciding?</Text>
            <View style={styles.row}>
              <Text style={styles.copy}>Watch ideas</Text>
              <Switch value={watchInterest} onValueChange={setWatchInterest} />
            </View>
            <View style={styles.row}>
              <Text style={styles.copy}>Restaurant ideas</Text>
              <Switch value={eatInterest} onValueChange={setEatInterest} />
            </View>
            <PrimaryButton label="Continue" onPress={() => setStep(2)} />
          </SurfaceCard>
        )}

        {step === 2 && (
          <SurfaceCard>
            <Text style={styles.header}>Set your couple nicknames</Text>
            <TextInput value={personA} onChangeText={setPersonA} placeholder="Person A" style={styles.input} />
            <TextInput value={personB} onChangeText={setPersonB} placeholder="Person B" style={styles.input} />
            <PrimaryButton label="Finish" onPress={finish} />
            <GhostButton label="Skip" onPress={finish} />
          </SurfaceCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: 80 },
  header: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  copy: { fontSize: 15, marginTop: 8, color: theme.colors.subText },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'white',
    padding: 12,
    borderRadius: theme.radius.md,
    marginTop: 12
  }
});
