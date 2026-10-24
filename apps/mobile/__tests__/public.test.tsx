import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicScreen } from '../src/screens/PublicScreen';
import { PublicDetail } from '../src/core/types';
import { dateTime } from '../src/core/format';
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn() },
}));
const data: PublicDetail = {
  package: {
    id: 'p1',
    title: 'Английский язык',
    totalLessons: 8,
    priceKopecks: 1200000,
    paymentStatus: 'paid',
    paidLessons: 8,
    completedLessons: 5,
    remainingLessons: 3,
    paidAt: '2026-10-20T10:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
  },
  lessons: [],
};
const mockFetch = jest.fn();
const ok = (value: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={client}>
      <PublicScreen token="private-link" />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});
it('opens without authentication and displays the server balance', async () => {
  mockFetch.mockResolvedValue(ok(data));
  await open();
  expect(await screen.findByText('Английский язык')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/public/subscriptions/private-link'),
    expect.objectContaining({ headers: { Accept: 'application/json' } }),
  );
  expect(screen.queryByText('Войти')).toBeNull();
  expect(screen.getByText('Следующее занятие')).toBeTruthy();
  expect(screen.getByText('Пока не запланировано')).toBeTruthy();
});
it('highlights the next future scheduled lesson from the public payload', async () => {
  const nearest = '2099-10-25T04:00:00Z';
  mockFetch.mockResolvedValue(
    ok({
      ...data,
      lessons: [
        {
          id: 'later',
          packageId: 'p1',
          scheduledAt: '2099-10-26T04:00:00Z',
          status: 'scheduled',
          updatedAt: nearest,
        },
        {
          id: 'cancelled',
          packageId: 'p1',
          scheduledAt: '2099-10-24T04:00:00Z',
          status: 'cancelled',
          updatedAt: nearest,
        },
        {
          id: 'next',
          packageId: 'p1',
          scheduledAt: nearest,
          status: 'scheduled',
          updatedAt: nearest,
        },
      ],
    }),
  );
  await open();
  await screen.findByText('Следующее занятие');
  expect(screen.getAllByText(dateTime(nearest))).toHaveLength(2);
  expect(screen.getAllByText(dateTime('2099-10-24T04:00:00Z'))).toHaveLength(1);
  expect(screen.queryByText('Пока не запланировано')).toBeNull();
});
it('uses the server remainingLessons value rather than recomputing a balance', async () => {
  mockFetch.mockResolvedValue(
    ok({ ...data, package: { ...data.package, remainingLessons: 2 } }),
  );
  await open();
  expect(await screen.findByText('2')).toBeTruthy();
  expect(screen.queryByText('3')).toBeNull();
});
it('replaces sensitive data with an invalid-link state after revocation', async () => {
  mockFetch
    .mockResolvedValueOnce(ok(data))
    .mockResolvedValue(
      ok({ error: { code: 'not_found', message: 'Ссылка не найдена' } }, 404),
    );
  const client = await open();
  await screen.findByText('Английский язык');
  await act(async () => {
    await client.refetchQueries({
      queryKey: ['public-subscription', 'private-link'],
    });
  });
  expect(await screen.findByText('Ссылка больше не действует')).toBeTruthy();
  expect(screen.queryByText('Английский язык')).toBeNull();
});
it('retries a network error from the visible update control', async () => {
  mockFetch
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(ok(data));
  await open();
  await screen.findByText('Не удалось обновить абонемент');
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('Английский язык')).toBeTruthy();
});
