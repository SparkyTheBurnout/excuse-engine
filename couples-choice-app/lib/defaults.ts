import { AppState } from '../types/models';

export const defaultState: AppState = {
  isOnboardingComplete: false,
  names: {
    personA: 'You',
    personB: 'Partner'
  },
  watchDefaults: {
    services: [],
    genres: [],
    moods: [],
    watchType: 'Either',
    newness: 'Either',
    surpriseMe: false
  },
  eatDefaults: {
    cuisines: [],
    distanceMax: 10,
    priceLevels: ['$', '$$', '$$$', '$$$$'],
    vibes: [],
    dinePreference: 'Either',
    openNowOnly: false,
    surpriseMe: false
  },
  history: [],
  favorites: [],
  fairness: {
    personAWinCount: 0,
    personBWinCount: 0,
    lastWinner: 'Tie'
  }
};
