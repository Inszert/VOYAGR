import { setDataSourceAction } from '@/app/actions/data-source';
import { cn } from '@/lib/cn';
import type { ActiveDataSource } from '@/providers/request-source';

/**
 * The runtime API/MOCK switch.
 *
 * Developer infrastructure, and it looks like it: a hairline segmented
 * control small enough to sit in the header beside the account, in the same
 * night palette as everything around it. It is not a product feature and it
 * does not try to look like one.
 *
 * **A form, not a click handler.** Two submit buttons in one form, so it
 * works before JavaScript arrives and is a real control to a screen reader.
 * With JavaScript, Next handles the submission in place and re-renders the
 * page - no reload - and without it the same POST produces a normal
 * navigation to the same page. Nothing about the behaviour depends on which.
 *
 * **It reports what is, not what was asked for.** `effective` is the source
 * that will actually answer. Selecting API on a deployment with no
 * credentials leaves the page on fixtures, and the control says so rather
 * than showing an "API" label over demo prices - which is the precise
 * failure the whole provenance system exists to prevent.
 */

const LABEL: Record<'api' | 'mock', string> = { api: 'API', mock: 'MOCK' };

export interface DataSourceSwitchProps {
  readonly source: ActiveDataSource;
  readonly className?: string;
}

export function DataSourceSwitch({ source, className }: DataSourceSwitchProps) {
  if (!source.switchEnabled) return null;

  const unavailable = source.selected === 'api' && source.effective === 'mock';

  return (
    <form
      action={setDataSourceAction}
      // A group rather than a radiogroup: these are two commands that take
      // effect immediately, not a choice pending a submit.
      aria-label="Data source"
      className={cn('flex items-center gap-2', className)}
    >
      <span
        aria-hidden="true"
        className="text-dim hidden text-[10px] tracking-[0.16em] uppercase lg:inline"
      >
        Data
      </span>

      <div className="border-hairline bg-field flex items-center rounded-[--radius-pill] border p-0.5">
        {(['api', 'mock'] as const).map((option) => {
          const active = source.effective === option;

          return (
            <button
              key={option}
              type="submit"
              name="source"
              value={option}
              // The state a screen reader hears, and the one the page is
              // actually in - not the one the cookie asked for.
              aria-pressed={active}
              className={cn(
                'ease-standard duration-quick focus-visible:outline-accent-ink rounded-[--radius-pill] px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors',
                active
                  ? option === 'mock'
                    ? 'bg-critical-500/20 text-critical-ink'
                    : 'voyagr-cta'
                  : 'text-muted hover:text-text',
              )}
            >
              {LABEL[option]}
              <span className="sr-only">
                {active ? ' — currently serving this page' : ' — switch to this source'}
              </span>
            </button>
          );
        })}
      </div>

      {unavailable ? (
        // Said out loud rather than implied by a control that refuses to
        // move. The switch is set to API and the page is not on API.
        <span role="status" className="text-caution-ink text-[11px]">
          No API provider is configured
        </span>
      ) : null}
    </form>
  );
}
