import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import { collectPages } from './paging';
import type { ProviderPage } from './types';

/**
 * Walking a provider's pages.
 *
 * "One call returns everything worth having" was false for every vendor
 * evaluated, so this is the path every search now takes. Both bounds matter,
 * and so does what happens when page two fails.
 */

const page = <T>(items: T[], nextCursor: string | null): ProviderPage<T> => ({
  items,
  nextCursor,
});

describe('collectPages', () => {
  it('follows the cursor until the provider runs out', async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) =>
      cursor === undefined ? ok(page(['a', 'b'], 'cursor-1')) : ok(page(['c'], null)),
    );

    const { result, error } = await collectPages(fetchPage, { maxItems: 10, maxPages: 5 });

    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
    expect(error).toBeNull();
  });

  it('passes the provider its own cursor back, unchanged', async () => {
    // A cursor is an opaque token whose meaning belongs to the vendor.
    const fetchPage = vi.fn(async (cursor: string | undefined) =>
      cursor ? ok(page(['b'], null)) : ok(page(['a'], 'opaque::token::1')),
    );

    await collectPages(fetchPage, { maxItems: 10, maxPages: 5 });

    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'opaque::token::1');
  });

  it('stops once it has enough, and says it was truncated', async () => {
    const fetchPage = vi.fn(async () => ok(page(['a', 'b'], 'always-more')));

    const { result } = await collectPages(fetchPage, { maxItems: 3, maxPages: 10 });

    expect(result.items).toHaveLength(4);
    expect(result.truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops at the page bound, so a cursor that never ends cannot loop forever', async () => {
    const fetchPage = vi.fn(async () => ok(page(['a'], 'always-more')));

    const { result } = await collectPages(fetchPage, { maxItems: 1000, maxPages: 3 });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.truncated).toBe(true);
  });

  it('keeps the pages it already had when a later one fails', async () => {
    // A partial result set is degraded, which the search knows how to report.
    // An empty one looks like "nothing exists", which is a different lie.
    const fetchPage = vi.fn(async (cursor: string | undefined) =>
      cursor === undefined
        ? ok(page(['a', 'b'], 'cursor-1'))
        : err(new AppError('PROVIDER_UNAVAILABLE', 'page two failed')),
    );

    const { result, error } = await collectPages(fetchPage, { maxItems: 10, maxPages: 5 });

    expect(result.items).toEqual(['a', 'b']);
    expect(result.truncated).toBe(true);
    expect(error).toBeInstanceOf(AppError);
  });

  it('reports a first-page failure as no items rather than throwing', async () => {
    const fetchPage = vi.fn(async () => err(new AppError('PROVIDER_UNAVAILABLE', 'down')));

    const { result, error } = await collectPages(fetchPage, { maxItems: 10, maxPages: 5 });

    expect(result.items).toEqual([]);
    expect(error).toBeInstanceOf(AppError);
  });

  it('makes one unpaginated page look exactly like one page of many', async () => {
    // An adapter with no pagination returns everything with a null cursor, and
    // callers cannot tell the difference. That is the point of the shape.
    const fetchPage = vi.fn(async () => ok(page(['a', 'b', 'c'], null)));

    const { result } = await collectPages(fetchPage, { maxItems: 10, maxPages: 5 });

    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
