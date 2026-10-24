import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AuthProvider } from '../src/core/auth';
import { sessionStorage } from '../src/core/storage';
import { AuthScreen } from '../src/screens/AuthScreen';
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  Redirect: () => null,
}));
jest.mock('../src/core/storage', () => ({
  sessionStorage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));
const mockFetch = jest.fn();
const ok = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
async function open(mode: 'login' | 'register' = 'login') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AuthScreen mode={mode} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Email');
}
beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
  jest.mocked(sessionStorage.get).mockResolvedValue(null);
  jest.mocked(sessionStorage.set).mockResolvedValue();
  jest.mocked(sessionStorage.remove).mockResolvedValue();
});
it('logs in through the API and stores the opaque session only after success', async () => {
  mockFetch.mockResolvedValue(
    ok({
      token: 'opaque-token',
      expiresAt: '2026-11-01T00:00:00Z',
      user: { id: 'u1', name: 'Ирина', email: 'teacher@example.com' },
    }),
  );
  await open();
  await fireEvent.changeText(
    screen.getByLabelText('Email'),
    'teacher@example.com',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Пароль'),
    'LongPassword123',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith('/dashboard'),
  );
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/auth/login'),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        email: 'teacher@example.com',
        password: 'LongPassword123',
      }),
    }),
  );
  expect(sessionStorage.set).toHaveBeenCalledWith('opaque-token');
});
it('preserves credentials and exposes a failed login without storing a token', async () => {
  mockFetch.mockResolvedValue(
    ok(
      { error: { code: 'unauthorized', message: 'Неверный email или пароль' } },
      401,
    ),
  );
  await open();
  await fireEvent.changeText(
    screen.getByLabelText('Email'),
    'teacher@example.com',
  );
  await fireEvent.changeText(screen.getByLabelText('Пароль'), 'WrongPassword');
  await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
  expect(await screen.findByText('Неверный email или пароль')).toBeTruthy();
  expect(screen.getByLabelText('Email').props.value).toBe(
    'teacher@example.com',
  );
  expect(screen.getByLabelText('Пароль').props.value).toBe('WrongPassword');
  expect(sessionStorage.set).not.toHaveBeenCalled();
});
it('validates registration password length before requesting the API', async () => {
  await open('register');
  await fireEvent.changeText(screen.getByLabelText('Ваше имя'), 'Ирина');
  await fireEvent.changeText(
    screen.getByLabelText('Email'),
    'teacher@example.com',
  );
  await fireEvent.changeText(screen.getByLabelText('Пароль'), 'short');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Зарегистрироваться' }),
  );
  expect(await screen.findByText('Не менее 10 символов')).toBeTruthy();
  expect(mockFetch).not.toHaveBeenCalled();
});
