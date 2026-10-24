import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
const KEY = 'abonent.session';
export const sessionStorage = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web')
      return typeof window === 'undefined'
        ? null
        : window.sessionStorage.getItem(KEY);
    return SecureStore.getItemAsync(KEY);
  },
  async set(token: string): Promise<void> {
    if (Platform.OS === 'web') {
      window.sessionStorage.setItem(KEY, token);
      return;
    }
    await SecureStore.setItemAsync(KEY, token);
  },
  async remove(): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.sessionStorage.removeItem(KEY);
      return;
    }
    await SecureStore.deleteItemAsync(KEY);
  },
};
