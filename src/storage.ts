import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createConnectionStore } from './connection-store';

// Keep credentials in separate Keychain items so the list cannot outgrow one item.
export const connections = createConnectionStore({
  async get(key) {
    return Platform.OS === 'web' ? globalThis.sessionStorage?.getItem(key) ?? null
      : SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    if (Platform.OS === 'web') {
      if (!globalThis.sessionStorage) throw new Error('浏览器无法保存电脑连接。');
      globalThis.sessionStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async remove(key) {
    if (Platform.OS === 'web') globalThis.sessionStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
});
