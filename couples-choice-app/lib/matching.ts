import {
  EatPreferences,
  FairnessState,
  RestaurantOption,
  WatchOption,
  WatchPreferences
} from '../types/models';

type RankedItem<T> = {
  item: T;
  score: number;
  overlapScore: number;
  compromiseScore: number;
  winnerBias: 'A' | 'B' | 'Tie';
};

const overlap = (a: string[], b: string[]) => a.filter((v) => b.includes(v));
const safeLength = (list: string[]) => (list.length === 0 ? 1 : list.length);

const fairnessBias = (fairness: FairnessState): { favorA: number; favorB: number } => {
  const delta = fairness.personAWinCount - fairness.personBWinCount;
  if (delta > 0) return { favorA: -0.5, favorB: 0.7 };
  if (delta < 0) return { favorA: 0.7, favorB: -0.5 };
  return { favorA: 0, favorB: 0 };
};

export const rankWatchOptions = (
  options: WatchOption[],
  a: WatchPreferences,
  b: WatchPreferences,
  fairness: FairnessState
): RankedItem<WatchOption>[] => {
  const fairnessWeight = fairnessBias(fairness);

  return options
    .map((item) => {
      let scoreA = 0;
      let scoreB = 0;

      const genresA = overlap(a.genres, item.genres).length / safeLength(a.genres);
      const genresB = overlap(b.genres, item.genres).length / safeLength(b.genres);
      scoreA += genresA * 2;
      scoreB += genresB * 2;

      const moodA = overlap(a.moods, item.moods).length / safeLength(a.moods);
      const moodB = overlap(b.moods, item.moods).length / safeLength(b.moods);
      scoreA += moodA * 2.5;
      scoreB += moodB * 2.5;

      if (a.services.length === 0 || a.services.includes(item.streamingService)) scoreA += 1;
      if (b.services.length === 0 || b.services.includes(item.streamingService)) scoreB += 1;

      if (a.watchType === 'Either' || a.watchType === item.type) scoreA += 1;
      if (b.watchType === 'Either' || b.watchType === item.type) scoreB += 1;

      if (!a.runtimeMax || item.runtime <= a.runtimeMax) scoreA += 1;
      if (!b.runtimeMax || item.runtime <= b.runtimeMax) scoreB += 1;

      if (a.newness === 'Either' || (a.newness === 'New' && item.isNew) || (a.newness === 'Comfort' && !item.isNew)) scoreA += 0.8;
      if (b.newness === 'Either' || (b.newness === 'New' && item.isNew) || (b.newness === 'Comfort' && !item.isNew)) scoreB += 0.8;

      if (a.surpriseMe) scoreA += Math.random() * 0.4;
      if (b.surpriseMe) scoreB += Math.random() * 0.4;

      scoreA += fairnessWeight.favorA;
      scoreB += fairnessWeight.favorB;

      const overlapScore = Math.min(scoreA, scoreB);
      const compromiseScore = Math.abs(scoreA - scoreB) < 1.8 ? 1 : 0;
      const winnerBias: 'A' | 'B' | 'Tie' = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'Tie';

      return {
        item,
        score: scoreA + scoreB + overlapScore + compromiseScore,
        overlapScore,
        compromiseScore,
        winnerBias
      };
    })
    .sort((x, y) => y.score - x.score);
};

export const rankRestaurantOptions = (
  options: RestaurantOption[],
  a: EatPreferences,
  b: EatPreferences,
  fairness: FairnessState
): RankedItem<RestaurantOption>[] => {
  const fairnessWeight = fairnessBias(fairness);

  return options
    .map((item) => {
      let scoreA = 0;
      let scoreB = 0;

      const cuisinesA = overlap(a.cuisines, item.cuisine).length / safeLength(a.cuisines);
      const cuisinesB = overlap(b.cuisines, item.cuisine).length / safeLength(b.cuisines);
      scoreA += cuisinesA * 2.2;
      scoreB += cuisinesB * 2.2;

      const vibesA = overlap(a.vibes, item.vibe).length / safeLength(a.vibes);
      const vibesB = overlap(b.vibes, item.vibe).length / safeLength(b.vibes);
      scoreA += vibesA * 1.8;
      scoreB += vibesB * 1.8;

      if (item.distanceMiles <= a.distanceMax) scoreA += 1.4;
      if (item.distanceMiles <= b.distanceMax) scoreB += 1.4;

      if (a.priceLevels.includes(item.priceLevel)) scoreA += 1.2;
      if (b.priceLevels.includes(item.priceLevel)) scoreB += 1.2;

      if (a.dinePreference === 'Either' || (a.dinePreference === 'Dine-In' && item.dineIn) || (a.dinePreference === 'Takeout' && item.takeout)) scoreA += 1;
      if (b.dinePreference === 'Either' || (b.dinePreference === 'Dine-In' && item.dineIn) || (b.dinePreference === 'Takeout' && item.takeout)) scoreB += 1;

      if (!a.openNowOnly || item.openNow) scoreA += 0.8;
      if (!b.openNowOnly || item.openNow) scoreB += 0.8;

      if (a.surpriseMe) scoreA += Math.random() * 0.4;
      if (b.surpriseMe) scoreB += Math.random() * 0.4;

      scoreA += fairnessWeight.favorA;
      scoreB += fairnessWeight.favorB;

      const overlapScore = Math.min(scoreA, scoreB);
      const compromiseScore = Math.abs(scoreA - scoreB) < 1.8 ? 1 : 0;
      const winnerBias: 'A' | 'B' | 'Tie' = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'Tie';

      return {
        item,
        score: scoreA + scoreB + overlapScore + compromiseScore + item.rating / 10,
        overlapScore,
        compromiseScore,
        winnerBias
      };
    })
    .sort((x, y) => y.score - x.score);
};

export const shortlistFromRanked = <T,>(ranked: RankedItem<T>[], size = 5): RankedItem<T>[] => {
  const top = ranked.slice(0, Math.max(size * 2, 6));
  const withRandomness = top
    .map((entry) => ({
      ...entry,
      score: entry.score + Math.random() * 0.25
    }))
    .sort((a, b) => b.score - a.score);

  return withRandomness.slice(0, size);
};
