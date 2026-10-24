import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Platform, Pressable, Text, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  darkColors,
  lightColors,
  ThemeProvider,
  useAppTheme,
} from '../src/core/theme';
import { Body, Card, Input, Notice, Page } from '../src/components/ui';

jest.mock('expo-router', () => ({ router: {} }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

const getSaved = jest.mocked(SecureStore.getItemAsync);
const setSaved = jest.mocked(SecureStore.setItemAsync);
const systemScheme = jest.mocked(useColorScheme);
const originalPlatform = Platform.OS;

function Probe() {
  const { mode, toggleTheme } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" onPress={toggleTheme}>
      <Text>{mode}</Text>
    </Pressable>
  );
}

beforeEach(() => {
  getSaved.mockResolvedValue(null);
  setSaved.mockResolvedValue();
  systemScheme.mockReturnValue('light');
});
afterEach(() => {
  jest.replaceProperty(Platform, 'OS', originalPlatform);
});

it('uses the system theme initially and keeps a safe light fallback outside a provider', async () => {
  systemScheme.mockReturnValue('dark');
  const view = await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByText('dark')).toBeTruthy();
  await view.unmount();
  await render(<Probe />);
  expect(screen.getByText('light')).toBeTruthy();
});

it('switches public-page controls, fields and messages and persists the native preference', async () => {
  let saved: string | null = null;
  getSaved.mockImplementation(async () => saved);
  setSaved.mockImplementation(async (_key, value) => {
    saved = value;
  });
  const view = await render(
    <ThemeProvider>
      <Page publicPage>
        <Card>
          <Body>Занятия</Body>
          <Input label="Имя" value="" />
          <Notice message="Ошибка" />
        </Card>
      </Page>
    </ThemeProvider>,
  );
  const toggle = screen.getByRole('switch', { name: 'Тёмная тема' });
  expect(toggle.props.accessibilityState.checked).toBe(false);
  await fireEvent.press(toggle);
  expect(toggle.props.accessibilityState.checked).toBe(true);
  expect(screen.getByText('Светлая тема')).toBeTruthy();
  expect(screen.getByText('Занятия')).toHaveStyle({ color: darkColors.ink });
  expect(screen.getByLabelText('Имя')).toHaveStyle({
    backgroundColor: darkColors.surface,
    color: darkColors.ink,
  });
  expect(screen.getByText('Ошибка')).toHaveStyle({ color: darkColors.danger });
  await waitFor(() =>
    expect(setSaved).toHaveBeenLastCalledWith('abonent.theme', 'dark'),
  );
  await view.unmount();
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await screen.findByText('dark');
});

it('does not overwrite a new choice with a late native storage read', async () => {
  let resolveRead!: (value: string) => void;
  getSaved.mockReturnValue(
    new Promise((resolve) => {
      resolveRead = resolve;
    }),
  );
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await fireEvent.press(screen.getByRole('button'));
  await act(async () => resolveRead('light'));
  expect(screen.getByText('dark')).toBeTruthy();
});

it('restores and updates the web preference in localStorage independently of authentication', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const store = new Map([['abonent.theme', 'dark']]);
  const storage = {
    getItem: jest.fn((key: string) => store.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => store.set(key, value)),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByText('dark')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button'));
  expect(screen.getByText('light')).toBeTruthy();
  expect(storage.setItem).toHaveBeenCalledWith('abonent.theme', 'light');
  expect(getSaved).not.toHaveBeenCalled();
  expect(setSaved).not.toHaveBeenCalled();
});

it('still switches themes when browser storage is unavailable', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw new Error('Storage is disabled');
      },
      setItem: () => {
        throw new Error('Storage is disabled');
      },
    },
  });
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByText('light')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button'));
  expect(screen.getByText('dark')).toBeTruthy();
});

it('returns to light colors after switching twice', async () => {
  await render(
    <ThemeProvider>
      <Page>
        <Body>Содержимое</Body>
      </Page>
    </ThemeProvider>,
  );
  await fireEvent.press(screen.getByRole('switch', { name: 'Тёмная тема' }));
  await fireEvent.press(screen.getByRole('switch', { name: 'Тёмная тема' }));
  expect(screen.getByText('Содержимое')).toHaveStyle({
    color: lightColors.ink,
  });
  await waitFor(() =>
    expect(setSaved).toHaveBeenLastCalledWith('abonent.theme', 'light'),
  );
});
