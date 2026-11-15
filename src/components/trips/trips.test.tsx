import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberAvatars, initialsOf } from './member-avatars';
import { SettleChecklist } from './settle-checklist';
import { TripCard } from './trip-card';

describe('initialsOf', () => {
  it('takes the first and last word, and survives one name or none', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('Ada King Lovelace')).toBe('AL');
    expect(initialsOf('ada')).toBe('AD');
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('MemberAvatars', () => {
  it('names everyone in words and counts the ones that do not fit', () => {
    render(<MemberAvatars names={['Ada Lovelace', 'Grace Hopper', 'Alan Turing']} max={2} />);

    expect(
      screen.getByText(/3 people: Ada Lovelace, Grace Hopper, Alan Turing/),
    ).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });
});

describe('TripCard', () => {
  const base = {
    id: 't1',
    name: 'Long weekend',
    destination: 'Lisbon',
    country: 'Portugal',
    dates: '1 – 4 May',
    nights: '3 nights',
    sharedWithYou: false,
    members: ['Ada Lovelace'],
    picture: null,
  } as const;

  it('is one link, named in full, with the dates and nights in words', () => {
    render(
      <ul>
        <TripCard {...base} />
      </ul>,
    );

    const link = screen.getByRole('link', {
      name: 'Open Long weekend, Lisbon, Portugal, 1 – 4 May',
    });
    expect(link).toHaveAttribute('href', '/trips/t1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('3 nights', { exact: false })).toBeInTheDocument();
  });

  it('says so, in words, when somebody else made the trip', () => {
    render(
      <ul>
        <TripCard {...base} sharedWithYou />
      </ul>,
    );
    expect(screen.getByText('Shared with you')).toBeInTheDocument();
  });

  it('says dates are not set rather than leaving a gap', () => {
    render(
      <ul>
        <TripCard {...base} dates={null} nights={null} />
      </ul>,
    );
    expect(screen.getByText('Dates not set')).toBeInTheDocument();
  });
});

describe('SettleChecklist', () => {
  beforeEach(() => window.localStorage.clear());

  const items = [
    { key: 'a-b-500', from: 'Ada', to: 'Grace', amount: '€5.00' },
    { key: 'c-b-250', from: 'Alan', to: 'Grace', amount: '€2.50' },
  ];

  it('lists every payment as a checkbox, with the figure that was handed in', () => {
    render(<SettleChecklist tripId="t1" currency="EUR" items={items} />);

    const list = screen.getByRole('list', { name: 'Payments in EUR' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: /Ada pays Grace.*€5\.00/ })).not.toBeChecked();
  });

  it('remembers a tick on this device and says the payment is paid', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SettleChecklist tripId="t1" currency="EUR" items={items} />);

    await user.click(screen.getByRole('checkbox', { name: /Ada pays Grace/ }));
    expect(screen.getByRole('checkbox', { name: /Ada pays Grace/ })).toBeChecked();
    expect(screen.getByText('Paid')).toBeInTheDocument();

    unmount();
    render(<SettleChecklist tripId="t1" currency="EUR" items={items} />);
    expect(await screen.findByRole('checkbox', { name: /Ada pays Grace/ })).toBeChecked();
  });
});
