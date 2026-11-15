import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  PageHeader,
  PasswordField,
  PlacePicture,
  StateScreen,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from './index';

/**
 * The primitives the account, trip, watch and status pages share.
 *
 * Roles, names and states, never class names.
 */

describe('PageHeader', () => {
  it('is one level-one heading, with the eyebrow and the supporting line around it', () => {
    render(<PageHeader eyebrow="Trips" title="Your trips" description="Keep them together." />);

    expect(screen.getByRole('heading', { level: 1, name: 'Your trips' })).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByText('Keep them together.')).toBeInTheDocument();
  });

  it('can be a section heading instead of a second page title', () => {
    render(<PageHeader level={2} title="Money" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Money' })).toBeInTheDocument();
  });
});

describe('PasswordField', () => {
  it('keeps the password hidden until the toggle is pressed, and says which state it is in', async () => {
    const user = userEvent.setup();
    render(<PasswordField label="Password" name="password" />);

    const input = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show characters' });

    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('is reachable by its label alone: the toggle is not also called "password"', () => {
    render(<PasswordField label="Password" name="password" />);
    expect(screen.getAllByLabelText('Password')).toHaveLength(1);
  });

  it('marks the field invalid and describes it by the message that explains why', () => {
    render(
      <>
        <p id="why">That email or password is not right.</p>
        <PasswordField label="Password" name="password" invalid describedBy="why" />
      </>,
    );

    const input = screen.getByLabelText('Password');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('That email or password is not right.');
  });
});

describe('Button loading', () => {
  it('is disabled and busy while it works, and keeps the label it is given', () => {
    render(
      <Button loading type="submit">
        Signing in…
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Signing in…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('StatusChip', () => {
  it('says the status in words, so colour is never the only signal', () => {
    render(<StatusChip kind="booked">Booked</StatusChip>);
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(screen.getByText('Booked')).toBeInTheDocument();
  });
});

describe('PlacePicture', () => {
  it('describes a picture as the illustration it is', () => {
    render(
      <PlacePicture
        picture={{ code: 'LIS', blur: 'data:image/webp;base64,AAAA', label: 'Lisbon, Portugal' }}
        initials="PO"
        sizes="100vw"
      />,
    );

    expect(
      screen.getByRole('img', { name: 'Lisbon, Portugal — AI-generated illustration' }),
    ).toBeInTheDocument();
  });

  it('draws the initials, and no image, for a place with no picture', () => {
    render(<PlacePicture picture={null} initials="GE" sizes="100vw" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('GE')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('opens the chosen tab and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="plan">
        <TabsList aria-label="Trip sections">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="money">Money</TabsTrigger>
        </TabsList>
        <TabsContent value="plan">The plan</TabsContent>
        <TabsContent value="money">The money</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('The plan');

    await user.click(screen.getByRole('tab', { name: 'Plan' }));
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Money' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('The money');
  });
});

describe('StateScreen', () => {
  it('is one heading, one sentence and one action', () => {
    render(
      <StateScreen
        kind="not-found"
        title="Page not found"
        description="That page does not exist."
        action={<a href="/start">Back to the start</a>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
