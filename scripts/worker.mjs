/**
 * Worker entry point.
 *
 * A thin launcher so the worker is `npm run worker` rather than a memorised
 * tsx incantation. Everything it does lives in `src/worker/main.ts`, which is
 * importable and therefore testable without starting a process.
 */

import { runWorkerProcess } from '../src/worker/main.ts';

await runWorkerProcess();
