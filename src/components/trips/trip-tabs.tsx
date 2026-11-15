'use client';

import * as React from 'react';
import { Icon, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';

/**
 * The three parts of a trip: Plan, Money, Emergency.
 *
 * Radix Tabs, so the arrow keys, Home and End, the roles and the focus
 * handling are Radix's. The open tab is kept in the address (`?tab=money`) so
 * a link opens on it and a reload stays put; it is written with
 * `replaceState`, so moving between tabs does not fill the back button.
 *
 * The panels arrive as already-rendered server output; this component only
 * decides which one is showing.
 */

export type TripTab = 'plan' | 'money' | 'emergency';

export const TRIP_TABS: readonly TripTab[] = ['plan', 'money', 'emergency'];

export function isTripTab(value: unknown): value is TripTab {
  return typeof value === 'string' && (TRIP_TABS as readonly string[]).includes(value);
}

export function TripTabs({
  initial,
  plan,
  money,
  emergency,
}: {
  initial: TripTab;
  plan: React.ReactNode;
  money: React.ReactNode;
  emergency: React.ReactNode;
}) {
  const onChange = React.useCallback((value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', value);
    window.history.replaceState(null, '', url);
  }, []);

  return (
    <Tabs defaultValue={initial} onValueChange={onChange}>
      <TabsList aria-label="Trip sections">
        <TabsTrigger value="plan">
          <Icon name="calendar" size={1} />
          Plan
        </TabsTrigger>
        <TabsTrigger value="money">
          <Icon name="tag" size={1} />
          Money
        </TabsTrigger>
        <TabsTrigger value="emergency">
          <Icon name="phone" size={1} />
          Emergency
        </TabsTrigger>
      </TabsList>

      <TabsContent value="plan">{plan}</TabsContent>
      <TabsContent value="money">{money}</TabsContent>
      <TabsContent value="emergency">{emergency}</TabsContent>
    </Tabs>
  );
}
