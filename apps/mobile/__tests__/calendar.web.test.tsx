import { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { DateTimeField } from '../src/components/DateTimeField.web';
import { Page } from '../src/components/ui';
import { ThemeProvider } from '../src/core/theme';
jest.mock('expo-router', () => ({ router: {} }));

// This test uses the jest-expo/web project and its real DOM renderer.

let root: Root;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});
function Picker() {
  const [value, setValue] = useState({ date: '2026-10-25', time: '14:30' });
  return (
    <>
      <DateTimeField value={value} onChange={setValue} />
      <output>
        {value.date} {value.time}
      </output>
    </>
  );
}
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing calendar control: ${selector}`);
  return found;
}
async function click(selector: string) {
  await act(async () => element(selector).click());
}
async function choose(label: string, value: string) {
  await act(async () => {
    const select = element<HTMLSelectElement>(`select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('chooses a calendar day and 24-hour time using real DOM controls', async () => {
  await act(async () => root.render(<Picker />));
  await click('[role="button"][aria-label^="Выбрать дату:"]');
  expect(
    element('[aria-label^="Выбрать дату:"]').getAttribute('aria-expanded'),
  ).toBe('true');
  expect(
    element('[aria-label="25 октября 2026 г."]').getAttribute('aria-pressed'),
  ).toBe('true');
  await click('[role="button"][aria-label="Следующий месяц"]');
  await click('[role="button"][aria-label="5 ноября 2026 г."]');
  await choose('Часы', '16');
  await choose('Минуты', '45');
  expect(element('output').textContent).toBe('2026-11-05 16:45');
  expect(document.querySelector('[aria-label="Следующий месяц"]')).toBeNull();
});
it('supports direct month/year selection and leap days while preserving time', async () => {
  await act(async () => root.render(<Picker />));
  await click('[role="button"][aria-label^="Выбрать дату:"]');
  await choose('Год', '2028');
  await choose('Месяц', '1');
  await click('[role="button"][aria-label="29 февраля 2028 г."]');
  expect(element('output').textContent).toBe('2028-02-29 14:30');
});

it('exposes the active theme to screen readers and restores it after a remount', async () => {
  window.localStorage.setItem('abonent.theme', 'light');
  const page = (
    <ThemeProvider>
      <Page>
        <div>Проверка темы</div>
      </Page>
    </ThemeProvider>
  );
  await act(async () => root.render(page));
  const selector = '[role="switch"][aria-label="Тёмная тема"]';
  expect(element(selector).getAttribute('aria-checked')).toBe('false');
  await click(selector);
  expect(element(selector).getAttribute('aria-checked')).toBe('true');
  expect(window.localStorage.getItem('abonent.theme')).toBe('dark');
  await act(async () => root.unmount());
  root = createRoot(document.body.firstElementChild!);
  await act(async () => root.render(page));
  expect(element(selector).getAttribute('aria-checked')).toBe('true');
});
