import { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Row } from './ui';
import { ThemeColors, useAppTheme } from '../core/theme';
interface Confirmation {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  run: () => void | Promise<void>;
}
export function useConfirmation() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirm = (value: Confirmation) => setConfirmation(value);
  const dialog = (
    <Modal
      visible={!!confirmation}
      transparent
      animationType="fade"
      onRequestClose={() => setConfirmation(null)}
    >
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>
            {confirmation?.title}
          </Text>
          <Text style={styles.body}>{confirmation?.message}</Text>
          <Row>
            <Button
              title="Не сейчас"
              variant="secondary"
              onPress={() => setConfirmation(null)}
            />
            <Button
              title={confirmation?.confirmLabel || 'Подтвердить'}
              variant={confirmation?.danger ? 'danger' : 'primary'}
              onPress={() => {
                const action = confirmation?.run;
                setConfirmation(null);
                void action?.();
              }}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
  return { confirm, dialog };
}
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    dialog: {
      width: '100%',
      maxWidth: 460,
      borderRadius: 18,
      backgroundColor: colors.surface,
      padding: 26,
      gap: 20,
    },
    title: { color: colors.ink, fontSize: 23, fontWeight: '700' },
    body: { color: colors.muted, fontSize: 15, lineHeight: 24 },
  });
