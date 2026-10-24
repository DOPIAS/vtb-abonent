import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import ClientScreen from '../app/(private)/clients/[id]';
import { ClientDetail, Package } from '../src/core/types';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'c1', renewPackage: 'p1' }),
}));
jest.mock('../src/core/auth', () => ({
  useSession: () => ({ token: 'teacher-session' }),
}));
const pack: Package = {
  id: 'p1',
  clientId: 'c1',
  title: 'Английский · 8 занятий',
  totalLessons: 8,
  priceKopecks: 1234567,
  paymentStatus: 'paid',
  paidLessons: 8,
  completedLessons: 7,
  remainingLessons: 1,
  paidAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
};
const detail: ClientDetail = {
  client: {
    id: 'c1',
    name: 'Анна',
    phone: '',
    contact: '',
    createdAt: '2026-10-01T00:00:00Z',
  },
  packages: [pack],
};
const mockFetch = jest.fn();
const ok = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => value,
});
async function open(data = detail) {
  mockFetch.mockImplementation(async (_url: string, options?: RequestInit) =>
    options?.method === 'POST'
      ? ok({
          ...pack,
          id: 'p2',
          paymentStatus: 'pending',
          paidLessons: 0,
          paidAt: null,
        })
      : ok(data),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await render(
    <QueryClientProvider client={client}>
      <ClientScreen />
    </QueryClientProvider>,
  );
  await screen.findByText('Анна');
  return invalidate;
}
beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});

it('prefills the paid package without creating or charging and submits edited terms only after confirmation', async () => {
  const invalidate = await open();
  expect(screen.getByLabelText('Название пакета').props.value).toBe(pack.title);
  expect(screen.getByLabelText('Количество занятий').props.value).toBe('8');
  expect(screen.getByLabelText('Общая стоимость, ₽').props.value).toBe(
    '12345.67',
  );
  expect(
    mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST'),
  ).toHaveLength(0);
  await fireEvent.changeText(screen.getByLabelText('Количество занятий'), '4');
  await fireEvent.press(screen.getByRole('button', { name: 'Создать пакет' }));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith('/packages/p2'));
  const createCalls = mockFetch.mock.calls.filter(
    ([, options]) => options?.method === 'POST',
  );
  expect(createCalls).toHaveLength(1);
  expect(createCalls[0]).toEqual([
    expect.stringContaining('/clients/c1/packages'),
    expect.objectContaining({
      body: JSON.stringify({
        title: pack.title,
        totalLessons: 4,
        priceKopecks: 1234567,
      }),
      method: 'POST',
    }),
  ]);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
});

it('allows cancelling renewal and opening a blank package without carrying payment', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.queryByLabelText('Название пакета')).toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole('button', { name: '+ Создать пакет' }),
  );
  expect(screen.getByLabelText('Название пакета').props.value).toBe('');
  expect(screen.getByLabelText('Общая стоимость, ₽').props.value).toBe('');
});

it('never uses an unpaid package as a renewal template', async () => {
  await open({
    ...detail,
    packages: [{ ...pack, paymentStatus: 'pending', paidAt: null }],
  });
  expect(screen.queryByLabelText('Название пакета')).toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
