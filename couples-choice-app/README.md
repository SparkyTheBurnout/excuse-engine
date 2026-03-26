# Pick Us (Expo MVP)

Couples decision app MVP with two modes:
- What Should We Watch?
- Where Should We Eat?

## Run

```bash
cd couples-choice-app
npm install
npm run start
```

Open with Expo Go on iPhone by scanning the QR code.

## Scripts

- `npm run ios`
- `npm run android`
- `npm run web`
- `npm run typecheck`

## Architecture

- Expo Router screens in `app/`
- shared UI in `components/`
- local datasets in `data/`
- matching engine in `lib/matching.ts`
- persisted app state in `store/appStore.tsx` via AsyncStorage
