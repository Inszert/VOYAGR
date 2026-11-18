// Writes src/discovery/airport-sizes.generated.json: the IATA codes of the globe's airport dots
// that are large or small, from the generated airport reference data. Medium is the default and
// is not listed. Never hand-edit the output; rerun this after build-geo or build-airports.
import { readFileSync, writeFileSync } from 'node:fs';

const ref = JSON.parse(readFileSync('src/providers/fixtures/airports.generated.json', 'utf8'));
const places = JSON.parse(readFileSync('public/geo/places.v2.json', 'utf8'));
const size = new Map(ref.map((a) => [a.iata, a.type]));
const out = { large: [], small: [] };
for (const f of places.features) {
  if (f.properties.kind !== 'airport') continue;
  const s = size.get(f.properties.iata);
  if (s === 'large' || s === 'small') out[s].push(f.properties.iata);
}
out.large.sort();
out.small.sort();
writeFileSync('src/discovery/airport-sizes.generated.json', JSON.stringify(out) + '\n');
process.stdout.write(`${out.large.length} large, ${out.small.length} small\n`);
