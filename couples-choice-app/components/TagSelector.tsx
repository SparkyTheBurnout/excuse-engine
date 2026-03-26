import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';

export function TagSelector({
  options,
  selected,
  onToggle
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <Pressable key={option} style={[styles.tag, isSelected && styles.selected]} onPress={() => onToggle(option)}>
            <Text style={[styles.text, isSelected && styles.selectedText]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  tag: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'white',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  selected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.chip
  },
  text: {
    color: theme.colors.text,
    fontWeight: '600'
  },
  selectedText: {
    color: theme.colors.primary
  }
});
