import { router } from 'expo-router';
import { Button, Card, Heading, Page } from '../src/components/ui';
export default function NotFound() {
  return (
    <Page>
      <Card>
        <Heading
          title="Страница не найдена"
          subtitle="Проверьте адрес или вернитесь в кабинет."
        />
        <Button title="На главную" onPress={() => router.replace('/')} />
      </Card>
    </Page>
  );
}
