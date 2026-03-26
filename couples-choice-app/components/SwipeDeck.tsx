import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';
import { GhostButton, PrimaryButton, SurfaceCard } from './ui';

export function SwipeDeck<T extends { id: string }>({
  items,
  render,
  onComplete
}: {
  items: T[];
  render: (item: T) => React.ReactNode;
  onComplete: (keptIds: string[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [kept, setKept] = useState<string[]>([]);

  const current = useMemo(() => items[index], [items, index]);
  const isDone = index >= items.length;

  const next = (keep: boolean) => {
    if (!current) return;
    const nextKept = keep ? [...kept, current.id] : kept;
    setKept(nextKept);
    const nextIndex = index + 1;
    if (nextIndex >= items.length) {
      onComplete(nextKept);
    }
    setIndex(nextIndex);
  };

  if (isDone) {
    return (
      <SurfaceCard>
        <Text style={styles.doneTitle}>Evaluating your mutual match…</Text>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <Text style={styles.counter}>
        Option {index + 1} / {items.length}
      </Text>
      {render(current)}
      <View style={styles.actions}>
        <GhostButton label="Pass" onPress={() => next(false)} />
        <PrimaryButton label="Keep" onPress={() => next(true)} />
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  counter: {
    color: theme.colors.subText,
    marginBottom: 8,
    fontWeight: '600'
  },
  actions: {
    marginTop: 8
  },
  doneTitle: {
    fontWeight: '700',
    fontSize: 18,
    color: theme.colors.text
  }
});
