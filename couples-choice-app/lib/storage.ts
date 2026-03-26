import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultState } from './defaults';
import { AppState, MatchRecord } from '../types/models';

const APP_KEY = 'pick-us-state';

export const storage = {
  async loadState(): Promise<AppState> {
    try {
      const raw = await AsyncStorage.getItem(APP_KEY);
      if (!raw) return defaultState;
      return { ...defaultState, ...JSON.parse(raw) } as AppState;
    } catch {
      return defaultState;
    }
  },

  async saveState(state: AppState): Promise<void> {
    await AsyncStorage.setItem(APP_KEY, JSON.stringify(state));
  },

  async reset(): Promise<void> {
    await AsyncStorage.removeItem(APP_KEY);
  },

  createRecord(mode: MatchRecord['mode'], itemId: string, itemTitle: string, reason: string): MatchRecord {
    return {
      id: `${mode}-${itemId}-${Date.now()}`,
      mode,
      itemId,
      itemTitle,
      matchedAt: new Date().toISOString(),
      reason
    };
  }
};
