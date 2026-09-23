import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/legal-page';

/**
 * The terms of use.
 *
 * Written around what Voyagr actually is today: a search and monitoring tool
 * that hands off to the provider that quoted a price, with no booking and no
 * payment of its own (`src/booking/handoff.ts`), with sample data labelled as
 * such on every figure it touches. It promises nothing the software does not
 * do, and says plainly what it cannot guarantee.
 */

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'The terms for using Voyagr: what it does, what it does not, and what it cannot promise.',
};

const sections: readonly LegalSection[] = [
  {
    id: 'what-it-is',
    title: 'What Voyagr is',
    body: (
      <>
        <p>
          Voyagr searches for complete trips - flights, a place to stay and the ride from the
          airport - prices them together, and can keep watching a search and tell you when a better
          combination appears.
        </p>
        <p>
          <strong>Voyagr does not sell travel.</strong> It does not take bookings or payments. When
          you choose to book, you are sent to the provider that quoted the price, and the booking,
          the payment and everything about the trip itself are between you and that provider, on
          their terms.
        </p>
      </>
    ),
  },
  {
    id: 'prices',
    title: 'Prices and availability',
    body: (
      <>
        <p>
          Every price is what a provider quoted when Voyagr asked, and each one says where it came
          from and how long ago. Prices and availability change, sometimes within minutes, so the
          price you are offered when you book may differ from the one shown here.
        </p>
        <p>
          Some figures are <strong>sample data</strong>, used while a part of the service is not yet
          connected to a real provider. Sample figures are labelled as demo or test data wherever
          they appear. They are not offers and cannot be booked.
        </p>
        <p>
          A cost Voyagr could not get a price for is shown as not priced, never as zero, and a fact
          a provider did not state is shown as unknown. Check the provider&rsquo;s own terms -
          baggage, cancellation, fees - before you pay.
        </p>
      </>
    ),
  },
  {
    id: 'rankings',
    title: 'Rankings and explanations',
    body: (
      <p>
        Scores and rankings are calculated by fixed rules from the prices, dates and preferences in
        your search, and every result shows how its score was reached. They are a way to compare
        trips, not advice that a trip is right for you.
      </p>
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    body: (
      <>
        <p>
          You need an account to save searches and watch them. Keep your password to yourself; you
          are responsible for what is done with your account. You can delete it at any time from
          your account page, which removes everything it holds.
        </p>
        <p>
          Each plan has limits on how many searches you can save and watch, and how often a watch is
          checked. Your account page shows the limits that apply to you.
        </p>
      </>
    ),
  },
  {
    id: 'fair-use',
    title: 'Using Voyagr fairly',
    body: (
      <>
        <p>Please do not:</p>
        <ul>
          <li>
            run automated searches against Voyagr, or scrape it, instead of using it as a person
            would;
          </li>
          <li>try to get around plan limits, rate limits or security measures;</li>
          <li>use Voyagr to break the law or the terms of the providers whose prices it shows.</li>
        </ul>
        <p>
          Every search costs real requests to real providers, so Voyagr may slow down or stop
          searches that look automated, and may close accounts used this way.
        </p>
      </>
    ),
  },
  {
    id: 'notifications',
    title: 'Watches and notifications',
    body: (
      <p>
        A watch checks your search again from time to time and tells you when it finds something
        materially better. It can miss a deal - a price can appear and disappear between two checks,
        or a provider can fail to answer - so a quiet watch does not mean nothing better exists.
      </p>
    ),
  },
  {
    id: 'content',
    title: 'Photographs and map data',
    body: (
      <p>
        Destination photographs come from Wikimedia Commons, under the licences their authors chose;
        the author and licence are named on destination and stay pages. Map geography comes from
        Natural Earth, which is in the public domain. Voyagr&rsquo;s own text and design belong to
        its operator.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'What Voyagr cannot promise',
    body: (
      <p>
        Voyagr is provided as it is. It tries hard to be right, and says so when it is not sure, but
        it depends on providers it does not control and cannot promise that every price, schedule or
        detail is complete, current or correct, or that the service will always be available. To the
        extent the law allows, Voyagr is not responsible for losses that come from relying on a
        price or detail that a provider changed or got wrong.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        These terms may change as Voyagr does - for example when booking or paid plans arrive. The
        date at the top says when they last changed, and a change that affects what you have agreed
        to will be pointed out before it applies.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated="2026-09-23"
      summary={
        <p>
          Voyagr finds and watches trips; the providers sell them. These terms say what that means
          for the prices you see, your account, and what Voyagr can and cannot promise.
        </p>
      }
      sections={sections}
    />
  );
}
