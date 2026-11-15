'use client';

import * as React from 'react';
import { Toggle } from 'radix-ui';
import { Field, type FieldProps } from './field';
import { Icon } from './icon';

/**
 * A password field with a reveal control.
 *
 * The control is a Radix `Toggle`, so its pressed state is `aria-pressed` and
 * the keyboard behaviour is Radix's. Its name is constant ("Show characters")
 * and the pressed state carries on/off, rather than the name flipping between
 * "Show" and "Hide" as well, which a screen reader would announce twice over.
 * The name deliberately does not repeat the word "password": the field's own
 * label already does, and two controls both called "Password" is a trap for
 * anyone finding a field by its label.
 *
 * 44px by 36px inside a 44px field: the target is the full height of the
 * input, with the right edge of the input as its own edge.
 */
export const PasswordField = React.forwardRef<
  HTMLInputElement,
  Omit<FieldProps, 'type' | 'trailing'>
>(function PasswordField(props, ref) {
  const [shown, setShown] = React.useState(false);

  return (
    <Field
      ref={ref}
      {...props}
      type={shown ? 'text' : 'password'}
      // The entry is a secret either way; a password manager and the browser
      // must not treat the revealed state as a plain text field to remember.
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <Toggle.Root
          pressed={shown}
          onPressedChange={setShown}
          aria-label="Show characters"
          className="text-ink-muted hover:text-ink data-[state=on]:text-ink hover:bg-surface-sunken ease-standard duration-quick inline-flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-(--radius-control) px-2 text-xs font-medium transition-colors"
        >
          <Icon name={shown ? 'eye-off' : 'eye'} size={1.1} />
          <span aria-hidden="true">{shown ? 'Hide' : 'Show'}</span>
        </Toggle.Root>
      }
    />
  );
});
