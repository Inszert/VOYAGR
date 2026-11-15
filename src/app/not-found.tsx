import Link from 'next/link';
import { Button, Container, Icon, StateScreen } from '@/components/ui';

export default function NotFound() {
  return (
    <Container size="wide" className="py-10 lg:py-16">
      <StateScreen
        kind="not-found"
        title="Page not found"
        description="That page does not exist, or it has moved."
        action={
          <Button asChild size="lg">
            <Link href="/">
              Back to the start
              <Icon name="arrow-right" size={1} />
            </Link>
          </Button>
        }
      />
    </Container>
  );
}
