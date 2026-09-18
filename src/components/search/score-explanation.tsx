import type { TripScore } from '@/core/trip/scoring';

/**
 * Why a trip scored what it scored (specification section 31.3).
 *
 * The score is a weighted sum and this is that sum, written out. It answers
 * "why is this 84 and not 91?" by showing every factor, how well the trip did
 * on it, how much it counted for this traveller's style, and what it therefore
 * contributed.
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
  return (
    <div className="flex flex-col gap-3">
      <table aria-labelledby={headingId} className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th scope="col" className="text-ink py-2 pr-3 font-medium">
              Factor
            </th>
            <th scope="col" className="text-ink py-2 pr-3 text-right font-medium">
              This trip
            </th>
            <th scope="col" className="text-ink py-2 pr-3 text-right font-medium">
              Counts for
            </th>
            <th scope="col" className="text-ink py-2 text-right font-medium">
              Adds
            </th>
          </tr>
        </thead>
        <tbody>
          {score.factors.map((factor) => (
            <tr key={factor.key} className="border-border border-b last:border-0">
              <th scope="row" className="text-ink py-2 pr-3 text-left font-normal">
                {factor.label}
              </th>
              <td className="text-ink py-2 pr-3 text-right tabular-nums">
                {percent(factor.value)}
              </td>
              <td className="text-ink-muted py-2 pr-3 text-right tabular-nums">
                {percent(factor.weight)}
              </td>
              <td className="text-ink py-2 text-right tabular-nums">
                {Math.round(factor.contribution * 100)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-border border-t-2">
            <th scope="row" colSpan={3} className="text-ink py-2 pr-3 text-left font-semibold">
              Complete Trip Value Score
            </th>
            <td className="text-ink py-2 text-right font-semibold tabular-nums">{score.score}</td>
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
