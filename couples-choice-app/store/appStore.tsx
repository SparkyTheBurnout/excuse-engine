import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { defaultState } from '../lib/defaults';
import { storage } from '../lib/storage';
import { AppState, MatchRecord } from '../types/models';

type AppStoreValue = {
  state: AppState;
  loading: boolean;
  updateState: (patch: Partial<AppState>) => void;
  addHistory: (record: MatchRecord) => void;
  addFavorite: (record: MatchRecord) => void;
  removeFavorite: (id: string) => void;
  resetAll: () => Promise<void>;
};

const AppStoreContext = createContext<AppStoreValue | undefined>(undefined);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    storage.loadState().then((loaded) => {
      setState(loaded);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading) {
      storage.saveState(state);
    }
  }, [state, loading]);

  const value = useMemo<AppStoreValue>(
    () => ({
      state,
      loading,
      updateState: (patch) => setState((prev) => ({ ...prev, ...patch })),
      addHistory: (record) => setState((prev) => ({ ...prev, history: [record, ...prev.history].slice(0, 50) })),
      addFavorite: (record) =>
        setState((prev) => ({
          ...prev,
          favorites: prev.favorites.some((f) => f.itemId === record.itemId) ? prev.favorites : [record, ...prev.favorites]
        })),
      removeFavorite: (id) => setState((prev) => ({ ...prev, favorites: prev.favorites.filter((f) => f.id !== id) })),
      resetAll: async () => {
        await storage.reset();
        setState(defaultState);
      }
    }),
    [state, loading]
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export const useAppStore = () => {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error('useAppStore must be used inside AppStoreProvider');
  }
  return context;
};
