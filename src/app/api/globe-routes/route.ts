import { NextResponse } from 'next/server';
import { getRepositories } from '@/db';
import { loadStoredRoutes, WORLD, type Bounds } from '@/discovery/stored-routes';

/**
 * Stored routes out of one origin, inside a box: `?origin=VIE&west=&south=&east=&north=`.
 *
 * **It never calls a flight provider or the MCP.** It reads the route graph and nothing else,
 * so the globe can ask it as often as it moves. The box is optional; without one it is the world.
 * Prices come only from clicking a route (`/api/route-offers`).
 */

export const dynamic = 'force-dynamic';

const IATA = /^[A-Z]{3}$/;

function number(params: URLSearchParams, name: string, fallback: number): number | null {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const origin = (params.get('origin') ?? '').toUpperCase();

  const bounds: Bounds | null = (() => {
    const west = number(params, 'west', WORLD.west);
    const south = number(params, 'south', WORLD.south);
    const east = number(params, 'east', WORLD.east);
    const north = number(params, 'north', WORLD.north);
    if (west === null || south === null || east === null || north === null) return null;
    if (south < -90 || north > 90 || south > north) return null;
    if (west < -180 || west > 180 || east < -180 || east > 180) return null;
    return { west, south, east, north };
  })();

  if (!IATA.test(origin) || !bounds) {
    return NextResponse.json(
      { title: 'The request was not valid.', status: 400 },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const routes = await loadStoredRoutes({
    origin,
    bounds,
    graph: getRepositories().routeGraph,
  });
  return NextResponse.json({ origin, routes }, { headers: { 'Cache-Control': 'no-store' } });
}
