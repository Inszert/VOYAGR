import type { TripScore } from '@/core/trip/scoring';

/**
 * Why a trip scored what it scored (specification section 31.3).
 *
 * The score is a weighted sum and this is that sum, written out: every factor,
 * a bar filled to how well the trip did on it, and what it therefore added,
 * strongest first. Still a table underneath - each row is a factor with its
 * values - so it reads as one to assistive technology; it simply has no rules
 * drawn between the rows.
 *
 * No model writes any of this. The engine produced the numbers and a test
 * asserts the score equals the sum of the contributions shown here.
 */

const percent = (value: number) => `${Math.round(value * 100)}%`;

export interface ScoreExplanationProps {
  score: TripScore;
  headingId?: string;
}

export function ScoreExplanation({ score, headingId }: ScoreExplanationProps) {
  // Ordered by what each added, which is the order that explains the score.
  const factors = [...score.factors].sort((a, b) => b.contribution - a.contribution);

  return (
    <div className="flex flex-col gap-3">
      <table aria-labelledby={headingId} className="w-full border-collapse text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Factor</th>
            <th scope="col">This trip</th>
            <th scope="col">Counts for</th>
            <th scope="col">Adds</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((factor) => (
            <tr key={factor.key}>
              <th scope="row" className="text-ink w-[38%] py-1.5 pr-3 text-left font-normal">
                {factor.label}
              </th>
              <td className="py-1.5 pr-3">
                <span className="sr-only">{percent(factor.value)}</span>
                <span
                  aria-hidden="true"
                  className="bg-surface-sunken block h-1 w-full overflow-hidden rounded-full"
                >
                  <span
                    className="bg-ink-muted block h-full rounded-full"
                    style={{ width: percent(Math.max(0, Math.min(1, factor.value))) }}
                  />
                </span>
              </td>
              <td className="text-dim w-14 py-1.5 pr-3 text-right text-xs tabular-nums">
                <span className="sr-only">counts for </span>
                {percent(factor.weight)}
              </td>
              <td className="text-ink w-10 py-1.5 text-right tabular-nums">
                +{Math.round(factor.contribution * 100)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3} className="text-ink pt-3 pr-3 text-left font-semibold">
              Complete Trip Value Score
            </th>
            <td className="text-ink pt-3 text-right font-semibold tabular-nums">{score.score}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-ink-muted text-sm">
        {percent(score.evidenceStrength)} of this score rests on figures a provider quoted rather
        than on our own estimates.
      </p>
    </div>
  );
}
