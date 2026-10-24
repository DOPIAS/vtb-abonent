import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10000,
        retry: (count, error) =>
          !(error instanceof ApiError && error.status < 500) && count < 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
