import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PackageScreen from '../app/(private)/packages/[id]';
import { Detail } from '../src/core/types';
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'p1' }),
}));
jest.mock('../src/core/auth', () => ({
  useSession: () => ({ token: 'teacher-session' }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
it('sends confirmed restore only after consent and displays the new server balance', async () => {
  let detail: Detail = {
    package: {
      id: 'p1',
      clientId: 'c1',
      title: 'Гитара',
      totalLessons: 8,
      priceKopecks: 1000000,
      paymentStatus: 'paid',
      paidLessons: 8,
      completedLessons: 5,
      remainingLessons: 3,
      paidAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-10-01T00:00:00Z',
    },
    lessons: [
      {
        id: 'l1',
        packageId: 'p1',
        scheduledAt: '2026-10-20T05:00:00Z',
        status: 'completed',
        updatedAt: '2026-10-20T05:00:00Z',
      },
    ],
  };
  const fetchMock = jest.fn(
    async (_url: string | URL | Request, options?: RequestInit) => {
      if (options?.method === 'PATCH')
        detail = {
          package: {
            ...detail.package,
            completedLessons: 4,
            remainingLessons: 4,
          },
          lessons: [{ ...detail.lessons[0]!, status: 'scheduled' }],
        };
      return { ok: true, status: 200, json: async () => detail } as Response;
    },
  );
  global.fetch = fetchMock;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await render(
    <QueryClientProvider client={client}>
      <PackageScreen />
    </QueryClientProvider>,
  );
  await screen.findByText('Гитара');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Исправить отметку о проведении' }),
  );
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method === 'PATCH'),
  ).toHaveLength(0);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Да, восстановить' }),
  );
  await screen.findByText('Отметка исправлена. Занятие восстановлено.');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/lessons/l1'),
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ action: 'restore', confirmed: true }),
      headers: expect.objectContaining({
        Authorization: 'Bearer teacher-session',
      }),
    }),
  );
  await waitFor(() => expect(screen.getAllByText('4')).toHaveLength(2));
  expect(screen.getByText('Запланировано')).toBeTruthy();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
});
