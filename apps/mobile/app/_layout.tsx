import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/core/auth';
import { createQueryClient } from '../src/core/query';
import { ThemeProvider, useAppTheme } from '../src/core/theme';

function AppNavigation() {
  const { mode, colors } = useAppTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      />
    </SafeAreaView>
  );
}

export default function RootLayout() {
  const [client] = useState(createQueryClient);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) =>
      focusManager.setFocused(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SafeAreaProvider>
            <AppNavigation />
          </SafeAreaProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
