import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Skeleton,
  SkipLink,
  ToggleChip,
} from './index';

/**
 * Design-system component tests.
 *
 * These assert accessible behaviour - roles, names, associations, states -
 * rather than markup or class names. A test that asserts on a class breaks on
 * every restyle and catches none of the bugs that matter.
 */

describe('Button', () => {
  it('renders as a button with its label as the accessible name', () => {
    render(<Button>Search trips</Button>);
    expect(screen.getByRole('button', { name: 'Search trips' })).toBeInTheDocument();
  });

  it('calls its handler on click', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is operable by keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalled();
  });

  it('marks a loading button busy while keeping its name', () => {
    // Swapping the label for a spinner would leave a screen reader with an
    // unnamed control mid-request.
    render(<Button loading>Searching</Button>);

    const button = screen.getByRole('button', { name: 'Searching' });
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link as a link, not a button, when asChild is used', () => {
    // A navigation control must be an anchor so it opens in a new tab, appears
    // in the links list and behaves as users expect.
    render(
      <Button asChild>
        <a href="/trips">Browse trips</a>
      </Button>,
    );

    expect(screen.getByRole('link', { name: 'Browse trips' })).toHaveAttribute('href', '/trips');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Field', () => {
  it('associates its label with the input', () => {
    render(<Field label="Maximum budget" />);
    expect(screen.getByLabelText('Maximum budget')).toBeInTheDocument();
  });

  it('keeps the label available to assistive tech when visually hidden', () => {
    render(<Field label="Search" hideLabel />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('links hint text through aria-describedby', () => {
    render(<Field label="Budget" hint="Total for the whole trip" />);

    expect(screen.getByLabelText('Budget')).toHaveAccessibleDescription('Total for the whole trip');
  });

  it('marks the control invalid and announces the error', () => {
    render(<Field label="Budget" error="Enter an amount above zero" />);

    const input = screen.getByLabelText('Budget');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount above zero');
  });

  it('announces a required field without relying on the asterisk alone', () => {
    // A red asterisk conveys nothing to a screen reader on its own.
    render(<Field label="Email" required />);

    expect(screen.getByLabelText(/Email/)).toBeRequired();
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });

  it('accepts typed input', async () => {
    render(<Field label="Budget" />);

    const input = screen.getByLabelText('Budget');
    await userEvent.type(input, '850');

    expect(input).toHaveValue('850');
  });
});

describe('Badge', () => {
  it('renders its text, so colour is never the only signal', () => {
    render(<Badge tone="caution">Estimated</Badge>);
    expect(screen.getByText('Estimated')).toBeInTheDocument();
  });

  it('prefixes context for assistive tech when asked', () => {
    render(
      <Badge tone="caution" srPrefix="Cost confidence">
        Estimated
      </Badge>,
    );

    expect(screen.getByText(/Cost confidence/)).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('lets the call site choose the heading level', () => {
    // A card in a results grid and a card on its own page sit at different
    // levels of the document outline.
    render(<CardTitle level={2}>Antalya</CardTitle>);
    expect(screen.getByRole('heading', { level: 2, name: 'Antalya' })).toBeInTheDocument();
  });

  it('can render as a labelled region', () => {
    render(
      <Card as="section" aria-label="Trip summary">
        Content
      </Card>,
    );

    expect(screen.getByRole('region', { name: 'Trip summary' })).toBeInTheDocument();
  });
});

describe('SkipLink', () => {
  it('points at the main content', () => {
    render(<SkipLink targetId="main-content" />);

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });

  it('is the first thing a keyboard user reaches', async () => {
    render(
      <>
        <SkipLink targetId="main-content" />
        <Button>Later control</Button>
      </>,
    );

    await userEvent.tab();

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus();
  });
});

describe('Card', () => {
  it('renders as the element the call site chose', () => {
    render(
      <Card as="article" aria-label="A trip">
        Content
      </Card>,
    );

    expect(screen.getByRole('article', { name: 'A trip' })).toBeInTheDocument();
  });

  it('gives a display title the display face without changing the outline', () => {
    // A heading that carries a page still has to sit at the right level.
    render(
      <CardTitle level={2} display>
        Find a trip
      </CardTitle>,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Find a trip' });
    expect(heading.className).toContain('font-display');
  });
});

describe('ToggleChip', () => {
  it('is a real checkbox, so it works in a form and without JavaScript', () => {
    // A filter that looks like a button and behaves like one is a filter
    // nobody can use before the JavaScript arrives.
    render(<ToggleChip name="direct" label="Direct flights" defaultChecked />);

    const chip = screen.getByRole('checkbox', { name: /Direct flights/ });
    expect(chip).toBeChecked();
    expect(chip).toHaveAttribute('name', 'direct');
  });

  it('toggles on click and stays keyboard reachable', async () => {
    render(<ToggleChip name="beach" label="Beach" />);
    const chip = screen.getByRole('checkbox', { name: 'Beach' });

    await userEvent.click(chip);
    expect(chip).toBeChecked();

    // sr-only rather than hidden, so it keeps its place in the tab order.
    chip.focus();
    expect(chip).toHaveFocus();
  });

  it('includes its hint in the accessible name', () => {
    render(<ToggleChip name="beach" label="Beach" hint="12" />);
    expect(screen.getByRole('checkbox', { name: 'Beach 12' })).toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('is silent to assistive technology unless it is labelled', () => {
    // A screen reader user gains nothing from twelve grey rectangles.
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces the wait once when it is the region’s own status', () => {
    render(<Skeleton label="Searching for trips" />);
    expect(screen.getByRole('status', { name: 'Searching for trips' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('offers something to do next', () => {
    // An empty state without an action is a dead end.
    render(
      <EmptyState
        title="No trips matched"
        description="Try widening the dates."
        action={<Button>Change dates</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No trips matched' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change dates' })).toBeInTheDocument();
  });

  it('announces an error but not an empty result', () => {
    // The user just asked for the search and is already looking at it; a
    // provider failing is news they did not expect.
    const { rerender } = render(<EmptyState title="Nothing found" description="No matches." />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<EmptyState tone="error" title="Search failed" description="A provider is down." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Search failed');
  });

  it('keeps a decorative icon out of the accessible name', () => {
    render(<EmptyState icon="🧭" title="Nothing yet" description="Start a search." />);
    expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeInTheDocument();
  });
});
