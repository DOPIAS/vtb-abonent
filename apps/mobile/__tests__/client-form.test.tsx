import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ClientForm } from '../src/components/ClientForm';
import { PHONE_ERROR } from '../src/core/phone';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

it('rejects an invalid phone before saving and keeps the entered values', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await render(<ClientForm onSave={save} onCancel={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText('Имя клиента'), 'Анна');
  await fireEvent.changeText(
    screen.getByLabelText('Телефон · необязательно'),
    '+7 (701) 123-45-67',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить клиента' }),
  );
  expect(await screen.findByText(PHONE_ERROR)).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Имя клиента').props.value).toBe('Анна');
  expect(screen.getByLabelText('Телефон · необязательно').props.value).toBe(
    '+7 (701) 123-45-67',
  );
});

it('normalizes a pasted Russian phone on blur and sends the canonical value', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await render(
    <ClientForm
      initial={{ name: 'Анна', contact: 'anna@example.com', phone: '' }}
      onSave={save}
      onCancel={jest.fn()}
    />,
  );
  await fireEvent.changeText(
    screen.getByLabelText('Телефон · необязательно'),
    '8 (999) 123-45-67',
  );
  await fireEvent(screen.getByLabelText('Телефон · необязательно'), 'blur');
  expect(screen.getByLabelText('Телефон · необязательно').props.value).toBe(
    '+79991234567',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить клиента' }),
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      name: 'Анна',
      contact: 'anna@example.com',
      phone: '+79991234567',
    }),
  );
});

it('saves a phone pasted immediately before submitting and permits clearing it', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await render(
    <ClientForm
      initial={{ name: 'Анна', contact: '@anna', phone: '+74951234567' }}
      onSave={save}
      onCancel={jest.fn()}
    />,
  );
  await fireEvent.changeText(
    screen.getByLabelText('Телефон · необязательно'),
    '9991234567',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить клиента' }),
  );
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith({
      name: 'Анна',
      contact: '@anna',
      phone: '+79991234567',
    }),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Телефон · необязательно'),
    '',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить клиента' }),
  );
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith({
      name: 'Анна',
      contact: '@anna',
      phone: '',
    }),
  );
});

it('allows email and freeform contacts with the optional phone left empty', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await render(<ClientForm onSave={save} onCancel={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText('Имя клиента'), 'Анна');
  await fireEvent.changeText(
    screen.getByLabelText('Другой контакт · необязательно'),
    'anna@example.com / @anna',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Сохранить клиента' }),
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      name: 'Анна',
      contact: 'anna@example.com / @anna',
      phone: '',
    }),
  );
});
