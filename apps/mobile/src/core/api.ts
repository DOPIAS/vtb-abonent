import { Platform } from 'react-native';

// Expo statically substitutes EXPO_PUBLIC_* variables at bundle time.
export const API_BASE = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web' ? '/api/v1' : 'http://localhost:8080/api/v1')
).replace(/\/$/, '');
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
let unauthorized: (() => void) | undefined;
export function onUnauthorized(handler?: () => void) {
  unauthorized = handler;
}
export async function request<T>(
  path: string,
  options: {
    token?: string | null;
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      let payload: { error?: { code?: string; message?: string } } = {};
      try {
        payload = await response.json();
      } catch {
        /* Proxy errors may have no JSON body. */
      }
      if (response.status === 401 && options.token) unauthorized?.();
      throw new ApiError(
        response.status,
        payload.error?.code || 'request_error',
        payload.error?.message ||
          `Ошибка сервера (${response.status}). Попробуйте ещё раз.`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new Error(
        'Запрос прерван или сервер долго не отвечает. Повторите попытку.',
      );
    throw new Error(
      'Не удалось связаться с сервером. Проверьте подключение и адрес API.',
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
