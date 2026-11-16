import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlanItemRecord } from '@/db/repository';

// The actions are server code; the forms around them are not what is under test.
vi.mock('@/app/actions/trips', () => ({
  addPlanItemAction: vi.fn(),
  removePlanItemAction: vi.fn(),
  setPlanItemStatusAction: vi.fn(),
  updatePlanItemAction: vi.fn(),
}));
vi.mock('@/components/trips/action-form', () => ({ ActionForm: () => null }));
vi.mock('@/components/trips/plan-item-fields', () => ({ PlanItemFields: () => null }));

import { PlanSection } from './plan-section';

function item(outboundUrl: string | null, id = 'p1'): PlanItemRecord {
  return {
    id,
    tripId: 't1',
    kind: 'activity',
    title: 'Hadrian’s Gate',
    date: '2026-12-01',
    startsAt: null,
    price: null,
    partnerOfferId: null,
    outboundUrl,
    status: 'idea',
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
  } as PlanItemRecord;
}

const render1 = (outboundUrl: string | null) =>
  render(<PlanSection tripId="t1" items={[item(outboundUrl)]} />);

describe('PlanSection outbound links', () => {
  it('links a place to its Wikipedia page, opening in a new tab without a referrer', () => {
    render1('https://en.wikipedia.org/wiki/Hadrian%27s_Gate');

    const link = screen.getByRole('link', { name: /Read about this place.*opens in a new tab/ });
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('links a place to Wikidata, and to Wikipedia in any language', () => {
    render1('https://www.wikidata.org/wiki/Q1');
    expect(screen.getByRole('link', { name: /Read about this place/ })).toBeInTheDocument();
  });

  it('is not an affiliate link, so no disclosure is shown for it', () => {
    render1('https://en.wikipedia.org/wiki/X');

    expect(screen.queryByText(/affiliate/i)).not.toBeInTheDocument();
  });

  it.each([
    ['plain http', 'http://en.wikipedia.org/wiki/X'],
    ['a look-alike host', 'https://en.wikipedia.org.evil.example/wiki/X'],
    ['a suffix trick', 'https://evilwikipedia.org/wiki/X'],
    ['embedded credentials', 'https://u:p@en.wikipedia.org/wiki/X'],
    ['a different site', 'https://example.com/'],
    ['a script', 'javascript:alert(1)'],
    ['not a URL', 'wikipedia'],
  ])('renders no link for %s', (_name, url) => {
    render1(url);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders no link when there is none', () => {
    render1(null);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
