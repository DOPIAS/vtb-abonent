import { PropsWithChildren, useMemo } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';
import { router } from 'expo-router';
import { errorMessage } from '../core/api';

import { ThemeColors, useAppTheme } from '../core/theme';

function useStyles() {
  const { colors } = useAppTheme();
  return { colors, s: useMemo(() => createStyles(colors), [colors]) };
}

function ThemeToggle() {
  const { mode, toggleTheme } = useAppTheme();
  const { s } = useStyles();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Тёмная тема"
      accessibilityHint="Переключает оформление и сохраняет выбор на этом устройстве"
      accessibilityState={{ checked: mode === 'dark' }}
      aria-checked={mode === 'dark'}
      onPress={toggleTheme}
      style={({ pressed }) => [s.themeToggle, pressed && s.pressed]}
    >
      <Text aria-hidden style={s.themeIcon}>
        {mode === 'dark' ? '☀' : '☾'}
      </Text>
      <Text style={s.themeToggleText}>
        {mode === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      </Text>
    </Pressable>
  );
}

export function Page({
  children,
  publicPage = false,
  navigation,
}: PropsWithChildren<{
  publicPage?: boolean;
  navigation?: 'dashboard' | 'clients';
}>) {
  const { s } = useStyles();
  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={s.canvas}
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.wrap}>
          <View style={s.brandRow}>
            <Text style={s.brand}>
              абонент<Text style={s.brandDot}>.</Text>
            </Text>
            <View style={s.brandActions}>
              <Text style={s.brandCaption}>
                {publicPage
                  ? 'Ваши занятия — на виду'
                  : 'Личный кабинет преподавателя'}
              </Text>
              <ThemeToggle />
            </View>
          </View>
          {navigation && (
            <Row>
              <Button
                title="Обзор"
                variant={navigation === 'dashboard' ? 'primary' : 'secondary'}
                onPress={() => router.replace('/dashboard')}
              />
              <Button
                title="Клиенты"
                variant={navigation === 'clients' ? 'primary' : 'secondary'}
                onPress={() => router.replace('/clients')}
              />
            </Row>
          )}
          {children}
          <Text style={s.footer}>
            {publicPage
              ? 'Актуальные данные вашего абонемента'
              : 'Меньше учёта. Больше любимого дела.'}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function Heading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { s } = useStyles();
  return (
    <View style={s.heading}>
      <View style={s.grow}>
        {eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
        <Text accessibilityRole="header" style={s.title}>
          {title}
        </Text>
        {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
      </View>
      {action}
    </View>
  );
}
export function Card({ children }: PropsWithChildren) {
  const { s } = useStyles();
  return <View style={s.card}>{children}</View>;
}
export function SectionTitle({ children }: PropsWithChildren) {
  const { s } = useStyles();
  return (
    <Text accessibilityRole="header" style={s.sectionTitle}>
      {children}
    </Text>
  );
}
export function Body({
  children,
  muted = false,
}: PropsWithChildren<{ muted?: boolean }>) {
  const { s } = useStyles();
  return <Text style={[s.body, muted && s.muted]}>{children}</Text>;
}
export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors, s } = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.secondary,
        variant === 'danger' && s.danger,
        variant === 'link' && s.link,
        (disabled || busy) && s.disabled,
        pressed && s.pressed,
      ]}
    >
      {busy && (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.onPrimary : colors.blue}
        />
      )}
      <Text
        style={[
          s.buttonText,
          variant !== 'primary' && s.secondaryText,
          variant === 'danger' && s.dangerText,
        ]}
      >
        {busy ? 'Подождите…' : title}
      </Text>
    </Pressable>
  );
}
export function Back({
  title = 'Назад',
  href,
}: {
  title?: string;
  href?: '/clients' | `/clients/${string}`;
}) {
  const { s } = useStyles();
  return (
    <View style={s.back}>
      <Button
        title={`← ${title}`}
        variant="link"
        onPress={() => (href ? router.replace(href) : router.back())}
      />
    </View>
  );
}
export function Row({ children }: PropsWithChildren) {
  const { s } = useStyles();
  return <View style={s.row}>{children}</View>;
}
export function Stack({ children }: PropsWithChildren) {
  const { s } = useStyles();
  return <View style={s.stack}>{children}</View>;
}
export function Notice({
  message,
  success = false,
}: {
  message: string;
  success?: boolean;
}) {
  const { s } = useStyles();
  return (
    <View
      accessibilityRole={success ? 'text' : 'alert'}
      style={[s.notice, success && s.success]}
    >
      <Text style={[s.noticeText, success && s.successText]}>{message}</Text>
    </View>
  );
}
export function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <Stack>
      <Notice message={errorMessage(error)} />
      {retry && (
        <Button variant="secondary" title="Повторить" onPress={retry} />
      )}
    </Stack>
  );
}
export function Loading({
  message = 'Загружаем данные…',
}: {
  message?: string;
}) {
  const { colors, s } = useStyles();
  return (
    <View style={s.loading}>
      <ActivityIndicator color={colors.blue} />
      <Body muted>{message}</Body>
    </View>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  const { s } = useStyles();
  return (
    <View style={s.empty}>
      <SectionTitle>{title}</SectionTitle>
      <Body muted>{detail}</Body>
    </View>
  );
}
export function Input(
  props: TextInputProps & { label: string; error?: string; hint?: string },
) {
  const { label, error, hint, ...input } = props;
  const { mode } = useAppTheme();
  const { colors, s } = useStyles();
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardAppearance={mode}
        placeholderTextColor={colors.placeholder}
        selectionColor={colors.blue}
        {...input}
        style={[s.input, input.style, error && s.inputError]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={s.fieldError}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={s.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}
export function FormInput<T extends FieldValues>({
  control,
  name,
  ...props
}: { control: Control<T>; name: Path<T> } & TextInputProps & {
    label: string;
    hint?: string;
  }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({
        field: { onChange, onBlur, value },
        fieldState: { error },
      }) => (
        <Input
          {...props}
          value={String(value ?? '')}
          onChangeText={onChange}
          onBlur={onBlur}
          error={error?.message}
        />
      )}
    />
  );
}
export function Badge({
  title,
  paid = false,
}: {
  title: string;
  paid?: boolean;
}) {
  const { s } = useStyles();
  return (
    <View style={[s.badge, paid && s.paidBadge]}>
      <Text style={[s.badgeText, paid && s.paidBadgeText]}>{title}</Text>
    </View>
  );
}
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    canvas: { flex: 1, backgroundColor: colors.canvas },
    page: { flexGrow: 1, padding: 20, paddingTop: 30 },
    wrap: { width: '100%', maxWidth: 1000, alignSelf: 'center', gap: 22 },
    grow: { flex: 1 },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 10,
      paddingBottom: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    brandActions: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      maxWidth: '100%',
      gap: 14,
    },
    themeToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      minHeight: 44,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    themeToggleText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    themeIcon: { color: colors.blue, fontSize: 20 },
    brand: {
      color: colors.ink,
      fontSize: 31,
      fontWeight: '800',
      letterSpacing: -1.5,
    },
    brandDot: { color: colors.blue },
    brandCaption: { color: colors.muted, fontSize: 12 },
    heading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    eyebrow: {
      color: colors.blue,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    title: {
      fontSize: 32,
      lineHeight: 39,
      fontWeight: '700',
      color: colors.ink,
      letterSpacing: -1,
    },
    subtitle: {
      fontSize: 15,
      lineHeight: 23,
      color: colors.muted,
      marginTop: 9,
      maxWidth: 650,
    },
    card: {
      padding: 24,
      borderRadius: 18,
      borderColor: colors.line,
      borderWidth: 1,
      backgroundColor: colors.surface,
      gap: 18,
    },
    sectionTitle: {
      fontSize: 19,
      lineHeight: 26,
      color: colors.ink,
      fontWeight: '600',
      letterSpacing: -0.3,
    },
    body: { fontSize: 15, lineHeight: 23, color: colors.ink },
    muted: { color: colors.muted },
    button: {
      backgroundColor: colors.blue,
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 19,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      minHeight: 48,
      gap: 9,
      flexShrink: 1,
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    secondary: {
      borderColor: colors.line,
      borderWidth: 1,
      backgroundColor: colors.surface,
    },
    secondaryText: { color: colors.blue },
    danger: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.danger,
      borderWidth: 1,
    },
    dangerText: { color: colors.danger },
    link: {
      backgroundColor: 'transparent',
      paddingHorizontal: 0,
      minHeight: 44,
    },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.75 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12,
    },
    stack: { gap: 16 },
    back: { alignSelf: 'flex-start', marginBottom: -12 },
    field: { gap: 7 },
    label: { fontSize: 14, fontWeight: '600', color: colors.ink },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 14,
      minHeight: 50,
      fontSize: 16,
    },
    inputError: { borderColor: colors.danger },
    fieldError: { color: colors.danger, fontSize: 12, lineHeight: 18 },
    hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    notice: {
      backgroundColor: colors.dangerSurface,
      borderRadius: 10,
      padding: 14,
    },
    noticeText: { color: colors.danger, fontSize: 14, lineHeight: 21 },
    success: { backgroundColor: colors.successSurface },
    successText: { color: colors.green },
    loading: { padding: 35, gap: 14, alignItems: 'center' },
    empty: { paddingVertical: 24, gap: 8 },
    footer: {
      color: colors.placeholder,
      fontSize: 12,
      textAlign: 'center',
      paddingVertical: 24,
    },
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: colors.warningSurface,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    badgeText: { color: colors.warningText, fontSize: 12, fontWeight: '600' },
    paidBadge: { backgroundColor: colors.successSurface },
    paidBadgeText: { color: colors.green },
  });
