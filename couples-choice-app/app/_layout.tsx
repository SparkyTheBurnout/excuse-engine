import { Stack } from 'expo-router';
import { AppStoreProvider } from '../store/appStore';

export default function Layout() {
  return (
    <AppStoreProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AppStoreProvider>
  );
}
