'use client';

import * as React from 'react';
import { Tabs as RadixTabs } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * Tabs, from Radix.
 *
 * Roving focus, arrow keys, Home/End and the `tablist`/`tab`/`tabpanel` wiring
 * are Radix's. What is added is the look: an underline that follows the
 * selection and 44px targets. `aria-selected` is the one source of truth for
 * "which is open"; the underline and the brighter ink are a second signal on
 * top of that, never the only one.
 *
 * `onValueChange` is how a page keeps the open tab in its address, so a link
 * to the Money tab opens on it.
 */

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('border-border flex gap-1 overflow-x-auto border-b', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'text-ink-muted hover:text-ink ease-standard duration-quick relative -mb-px inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent px-4 text-sm font-medium whitespace-nowrap transition-colors',
        'data-[state=active]:text-ink data-[state=active]:border-brand-ink',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('pt-8', className)} {...props} />;
}
