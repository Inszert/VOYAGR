import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No visitor-facing code may reach the live LiteAPI client.
 *
 * The Part 10 rule is that a visitor's request makes zero LiteAPI calls: pages read our own
 * snapshot, and only the worker's scheduled job calls the vendor. A test that a search makes no
 * fetch proves it for the paths the test exercises; this proves it for every path, by reading
 * the import graph. Starting from every file under `src/app/**`, no chain of static or dynamic
 * imports may arrive at the live adapter or the refresh job.
 */

const SRC = resolve(__dirname, '..');

/** What a visitor must never reach. Paths relative to `src`, with `/` separators. */
const FORBIDDEN = [
  'providers/stays/liteapi.ts',
  'liteapi-snapshot/job.ts',
  'providers/flights/liteapi.ts',
  'liteapi-snapshot/flights-job.ts',
];

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const IMPORT =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null; // a package

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    const target = specifier ? resolveImport(file, specifier) : null;
    if (target) found.push(target);
  }
  return found;
}

/** Every file reachable from `roots`, each with the chain that reached it. */
function reach(roots: readonly string[], allowed: readonly string[] = []): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  const queue: string[] = [];
  for (const root of roots) {
    chains.set(root, [root]);
    queue.push(root);
  }
  while (queue.length > 0) {
    const file = queue.shift()!;
    // An allowed module is reached, but its own imports are not followed.
    if (allowed.includes(file)) continue;
    for (const target of importsOf(file)) {
      if (chains.has(target)) continue;
      chains.set(target, [...chains.get(file)!, target]);
      queue.push(target);
    }
  }
  return chains;
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/');

/** The one visitor-triggered module that may call the vendor: "Check this price" (Part 6). */
const ALLOWED = [join(SRC, 'booking/liteapi-prebook.ts')];

describe('the visitor import guard', () => {
  const appFiles = walk(join(SRC, 'app'));
  const reachable = reach(appFiles, ALLOWED);

  it('looks at the app, and the graph walk finds real edges', () => {
    expect(appFiles.length).toBeGreaterThan(20);
    // The stays page reads through the registry, which must be in the graph.
    expect(reachable.has(join(SRC, 'providers/stays/registry.ts'))).toBe(true);
    expect(reachable.has(join(SRC, 'providers/stays/snapshot.ts'))).toBe(true);
    expect(reachable.has(join(SRC, 'liteapi-snapshot/read.ts'))).toBe(true);
  });

  it.each(FORBIDDEN)('no file under src/app reaches %s', (forbidden) => {
    const chain = reachable.get(join(SRC, forbidden));

    expect(chain ? chain.map(rel).join(' -> ') : null).toBeNull();
  });

  it('keeps the read path free of the vendor client and of fetch', () => {
    for (const file of [
      'liteapi-snapshot/read.ts',
      'providers/stays/snapshot.ts',
      'liteapi-snapshot/flights-read.ts',
      'providers/flights/liteapi-snapshot.ts',
    ]) {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/providers\/(stays|flights)\/liteapi['"]|\.\/liteapi['"]/);
    }
  });

  it('is only the worker that reaches the job', () => {
    const fromWorker = reach([join(SRC, 'worker/main.ts')]);

    expect(fromWorker.has(join(SRC, 'liteapi-snapshot/job.ts'))).toBe(true);
    expect(fromWorker.has(join(SRC, 'providers/stays/liteapi.ts'))).toBe(true);
    expect(fromWorker.has(join(SRC, 'liteapi-snapshot/flights-job.ts'))).toBe(true);
    expect(fromWorker.has(join(SRC, 'providers/flights/liteapi.ts'))).toBe(true);
  });

  it('reaches the flights reader from the app, through the registry', () => {
    expect(reachable.has(join(SRC, 'providers/flights/liteapi-snapshot.ts'))).toBe(true);
    expect(reachable.has(join(SRC, 'liteapi-snapshot/flights-read.ts'))).toBe(true);
  });

  it('would catch a violation: a graph containing the adapter does reach it', () => {
    // Guards the guard: the walk follows an import chain of at least two hops.
    const fromJob = reach([join(SRC, 'liteapi-snapshot/job.ts')]);
    const chain = fromJob.get(join(SRC, 'providers/stays/liteapi.ts'));

    expect(chain?.length).toBe(2);
  });
});
