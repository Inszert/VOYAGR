import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Container } from '@/components/ui';

/**
 * Where a successful verification link lands.
 *
 * The link in the email is a plain GET that verifies the address and redirects
 * here, so the person sees one plain sentence saying the address is confirmed,
 * with two ways on: to the account, or to searching. It promises nothing about
 * prices or trips and reads no session - the redirect is the proof.
 */

export const metadata: Metadata = { title: 'Email confirmed' };

export default function EmailConfirmedPage() {
  return (
    <Container className="py-10 lg:py-16">
      <section
        aria-labelledby="email-confirmed-title"
        className="mx-auto flex max-w-md flex-col items-start gap-5 py-10"
      >
        <h1
          id="email-confirmed-title"
          className="font-display text-display-sm sm:text-display-md text-ink text-balance"
        >
          Your email is confirmed
        </h1>

        <p className="text-ink-muted max-w-[44ch] text-[0.9375rem] leading-relaxed">
          Thanks for checking this address. Your account is ready to use.
        </p>

        <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild size="lg">
            <Link href="/account">Continue to your account</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/explore">Search trips</Link>
          </Button>
        </div>
      </section>
    </Container>
  );
}
