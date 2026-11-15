'use client';

import * as React from 'react';
import { publishStageData, type StageData } from './stage-store';

/**
 * Hands the persistent globe what this page wants it to show.
 *
 * Renders nothing. The server component that owns the page computed `data`
 * and passes it down as plain serialisable props; this publishes it from an
 * effect, so the globe applies it in place (`setData`, diffed markers, an
 * eased camera) instead of being built again. A new navigation produces a new
 * object, which is what ends the pending state.
 */
export function StageSync({ data }: { data: StageData }) {
  React.useEffect(() => {
    publishStageData(data);
  }, [data]);

  return null;
}
