import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import DashboardScreen from '../app/(private)/dashboard';
import { Dashboard } from '../src/core/types';
import { money } from '../src/core/format';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));
jest.mock('../src/core/auth', () => ({
  useSession: () => ({
    token: 'teacher-session',
    user: { name: 'Ирина' },
    logout: jest.fn(),
  }),
}));

const data: Dashboard = {
  asOf: '2026-10-24T04:00:00Z',
  totals: {
    clientCount: 3,
    paidPackageCount: 2,
    pendingPackageCount: 1,
    confirmedPaymentsKopecks: 2000000,
    pendingPaymentsKopecks: 900000,
    completedLessons: 6,
    remainingLessons: 4,
    remainingValueKopecks: 812345,
  },
  renewals: [
    {
      clientId: 'c2',
      clientName: 'Анна',
      packageId: 'p2',
      packageTitle: 'Гитара',
      totalLessons: 2,
      priceKopecks: 400000,
      remainingLessons: 1,
    },
  ],
  upcomingLessons: [
    {
      id: 'l1',
      packageId: 'p1',
      clientId: 'c1',
      clientName: 'Марк',
      packageTitle: 'Английский',
      scheduledAt: '2026-10-25T04:00:00Z',
    },
  ],
};
const mockFetch = jest.fn();
const ok = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => value,
});
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={client}>
      <DashboardScreen />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});

it('uses protected server totals and opens the renewal form and upcoming package', async () => {
  mockFetch.mockResolvedValue(ok(data));
  await open();
  expect(await screen.findByText(money(812345))).toBeTruthy();
  expect(screen.getByText(money(2000000))).toBeTruthy();
  expect(screen.getByText('4')).toBeTruthy();
  expect(screen.getByText(/Получение денег вы отмечаете вручную/)).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/dashboard'),
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer teacher-session',
      }),
    }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Новый пакет для Анна' }),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/clients/[id]',
    params: { id: 'c2', renewPackage: 'p2' },
  });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Открыть занятие Марк' }),
  );
  expect(router.push).toHaveBeenCalledWith('/packages/p1');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('shows a loading state until the dashboard arrives', async () => {
  let resolve!: (value: unknown) => void;
  mockFetch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await open();
  expect(screen.getByText('Собираем обзор вашей практики…')).toBeTruthy();
  await act(async () => resolve(ok(data)));
  expect(await screen.findByText('Заканчиваются занятия')).toBeTruthy();
});

it('lets a new teacher start from clients without invented metrics', async () => {
  mockFetch.mockResolvedValue(
    ok({
      ...data,
      totals: { ...data.totals, clientCount: 0 },
      renewals: [],
      upcomingLessons: [],
    }),
  );
  await open();
  await screen.findByText('Начните с первого клиента');
  expect(screen.queryByText('Подтверждено оплат')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Добавить первого клиента' }),
  );
  expect(router.push).toHaveBeenCalledWith('/clients');
});

it('shows a network failure with retry and empty schedule/renewal states', async () => {
  mockFetch
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(ok({ ...data, renewals: [], upcomingLessons: [] }));
  await open();
  await screen.findByText(
    'Не удалось связаться с сервером. Проверьте подключение и адрес API.',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('Никто не выпал из внимания')).toBeTruthy();
  expect(screen.getByText('Есть место для новых планов')).toBeTruthy();
});
