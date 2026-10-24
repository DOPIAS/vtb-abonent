import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'light' | 'dark';
export interface ThemeColors {
  blue: string;
  ink: string;
  muted: string;
  line: string;
  canvas: string;
  pale: string;
  danger: string;
  green: string;
  surface: string;
  inputBorder: string;
  placeholder: string;
  onPrimary: string;
  dangerSurface: string;
  successSurface: string;
  warningSurface: string;
  warningText: string;
  hero: string;
  heroText: string;
  heroMuted: string;
  overlay: string;
}
export const lightColors: ThemeColors = {
  blue: '#0069B3',
  ink: '#202328',
  muted: '#646D75',
  line: '#E2E8EE',
  canvas: '#F5F8FB',
  pale: '#EBF5FC',
  danger: '#AB3030',
  green: '#24704A',
  surface: '#FFFFFF',
  inputBorder: '#CED8E1',
  placeholder: '#73808C',
  onPrimary: '#FFFFFF',
  dangerSurface: '#FFF3F1',
  successSurface: '#EAF6ED',
  warningSurface: '#FFF6DF',
  warningText: '#826212',
  hero: '#0069B3',
  heroText: '#FFFFFF',
  heroMuted: '#D9ECF9',
  overlay: '#142B4866',
};
export const darkColors: ThemeColors = {
  blue: '#8BCBFF',
  ink: '#EDF3F9',
  muted: '#A9B8C7',
  line: '#314356',
  canvas: '#0D1722',
  pale: '#203A50',
  danger: '#FFADA7',
  green: '#8ED8AE',
  surface: '#172533',
  inputBorder: '#52677A',
  placeholder: '#98AABD',
  onPrimary: '#092238',
  dangerSurface: '#40272B',
  successSurface: '#19392F',
  warningSurface: '#40371F',
  warningText: '#F5D783',
  hero: '#153D5E',
  heroText: '#F4F9FF',
  heroMuted: '#C0DCEF',
  overlay: '#02080DBB',
};

const STORAGE_KEY = 'abonent.theme';
const isMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark';

function webPreference(): ThemeMode | null {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isMode(stored) ? stored : null;
  } catch {
    // Restricted browser storage must not prevent using the application.
    return null;
  }
}

interface AppTheme {
  mode: ThemeMode;
  colors: ThemeColors;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
}
const fallback: AppTheme = {
  mode: 'light',
  colors: lightColors,
  toggleTheme: () => {},
  setMode: () => {},
};
const Context = createContext<AppTheme>(fallback);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemMode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [mode, updateMode] = useState<ThemeMode>(
    () => webPreference() ?? systemMode,
  );
  const modeRef = useRef(mode);
  const explicitChoice = useRef(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (active && !explicitChoice.current && isMode(saved)) {
          modeRef.current = saved;
          updateMode(saved);
        }
      })
      .catch(() => {
        // Keep the system default if secure storage is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    explicitChoice.current = true;
    modeRef.current = next;
    updateMode(next);
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // The current choice still applies when persistence is disabled.
      }
      return;
    }
    // Serialize native writes so the last choice wins even after rapid toggles.
    writes.current = writes.current
      .catch(() => {})
      .then(() => SecureStore.setItemAsync(STORAGE_KEY, next))
      .catch(() => {});
  }, []);
  const toggleTheme = useCallback(
    () => setMode(modeRef.current === 'light' ? 'dark' : 'light'),
    [setMode],
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = mode;
    document.documentElement.style.backgroundColor =
      mode === 'dark' ? darkColors.canvas : lightColors.canvas;
  }, [mode]);

  const value = useMemo<AppTheme>(
    () => ({
      mode,
      colors: mode === 'dark' ? darkColors : lightColors,
      toggleTheme,
      setMode,
    }),
    [mode, toggleTheme, setMode],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppTheme(): AppTheme {
  return useContext(Context);
}
