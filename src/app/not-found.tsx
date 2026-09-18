import Link from 'next/link';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@/components/ui';

export default function NotFound() {
  return (
    <Card as="section" className="max-w-xl">
      <CardHeader>
        <CardTitle level={2}>Page not found</CardTitle>
        <CardDescription>That page does not exist, or it has moved.</CardDescription>
      </CardHeader>

      <Button asChild>
        <Link href="/">Back to the start</Link>
      </Button>
    </Card>
  );
}
