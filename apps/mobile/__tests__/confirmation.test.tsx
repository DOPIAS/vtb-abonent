import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { useConfirmation } from '../src/components/Confirm';
import { Button } from '../src/components/ui';
jest.mock('expo-router', () => ({ router: {} }));
it('requires explicit confirmation before restoring a completed lesson', async () => {
  const restore = jest.fn();
  function Example() {
    const { confirm, dialog } = useConfirmation();
    return (
      <View>
        <Button
          title="Исправить"
          onPress={() =>
            confirm({
              title: 'Восстановить занятие?',
              message: 'Подтвердите восстановление остатка.',
              confirmLabel: 'Да, восстановить',
              run: restore,
            })
          }
        />
        {dialog}
      </View>
    );
  }
  await render(<Example />);
  await fireEvent.press(screen.getByRole('button', { name: 'Исправить' }));
  expect(restore).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Не сейчас' }));
  expect(restore).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Исправить' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Да, восстановить' }),
  );
  expect(restore).toHaveBeenCalledTimes(1);
});
