export type Mode = 'watch' | 'eat';

export type Mood =
  | 'Cozy'
  | 'Adventurous'
  | 'Feel-Good'
  | 'Romantic'
  | 'Intense'
  | 'Funny'
  | 'Chill';

export type WatchType = 'Movie' | 'Series';
export type NewnessPreference = 'New' | 'Comfort' | 'Either';

export type WatchOption = {
  id: string;
  title: string;
  genres: string[];
  moods: Mood[];
  runtime: number;
  type: WatchType;
  streamingService: string;
  year: number;
  isNew: boolean;
  description: string;
};

export type PriceLevel = '$' | '$$' | '$$$' | '$$$$';
export type DinePreference = 'Dine-In' | 'Takeout' | 'Either';

export type RestaurantOption = {
  id: string;
  name: string;
  cuisine: string[];
  priceLevel: PriceLevel;
  vibe: Mood[];
  distanceMiles: number;
  dineIn: boolean;
  takeout: boolean;
  openNow: boolean;
  rating: number;
  description: string;
};

export type WatchPreferences = {
  services: string[];
  genres: string[];
  moods: Mood[];
  watchType: WatchType | 'Either';
  runtimeMax?: number;
  newness: NewnessPreference;
  surpriseMe: boolean;
};

export type EatPreferences = {
  cuisines: string[];
  distanceMax: number;
  priceLevels: PriceLevel[];
  vibes: Mood[];
  dinePreference: DinePreference;
  openNowOnly: boolean;
  surpriseMe: boolean;
};

export type CoupleNames = {
  personA: string;
  personB: string;
};

export type MatchRecord = {
  id: string;
  mode: Mode;
  itemId: string;
  itemTitle: string;
  matchedAt: string;
  reason: string;
};

export type FairnessState = {
  personAWinCount: number;
  personBWinCount: number;
  lastWinner: 'A' | 'B' | 'Tie';
};

export type AppState = {
  isOnboardingComplete: boolean;
  names: CoupleNames;
  watchDefaults: WatchPreferences;
  eatDefaults: EatPreferences;
  history: MatchRecord[];
  favorites: MatchRecord[];
  fairness: FairnessState;
};
