"""Offline tests for the sidecar: parameter validation, cache, throttle, result mapping.

No network and no `fast_flights` import is needed. Run: python -m unittest test_server -v
"""

import unittest
from datetime import date
from types import SimpleNamespace as NS

import server

TODAY = date(2026, 11, 16)


def q(**kwargs):
    base = {"origin": "vie", "destination": "FCO", "date": "2026-12-07"}
    base.update(kwargs)
    return {k: [v] for k, v in base.items() if v is not None}


class ValidateParams(unittest.TestCase):
    def test_minimal_query_gets_defaults_and_uppercase_codes(self):
        p = server.validate_params(q(), today=TODAY)
        self.assertEqual((p.origin, p.destination, p.adults, p.currency), ("VIE", "FCO", 1, "EUR"))
        self.assertIsNone(p.return_date)
        self.assertIsNone(p.max_stops)

    def test_rejects_bad_airport_codes(self):
        for bad in ("VI", "VIEN", "V1E", ""):
            with self.assertRaises(server.ParamError):
                server.validate_params(q(origin=bad), today=TODAY)

    def test_origin_must_differ_from_destination(self):
        with self.assertRaises(server.ParamError):
            server.validate_params(q(destination="VIE"), today=TODAY)

    def test_date_boundaries(self):
        server.validate_params(q(date="2026-11-16"), today=TODAY)  # today is allowed
        with self.assertRaises(server.ParamError):
            server.validate_params(q(date="2026-11-15"), today=TODAY)
        server.validate_params(q(date="2027-11-16"), today=TODAY)  # exactly 365 days
        with self.assertRaises(server.ParamError):
            server.validate_params(q(date="2027-11-17"), today=TODAY)

    def test_rejects_malformed_and_impossible_dates(self):
        for bad in ("2026-13-01", "2026-02-30", "07-12-2026", "tomorrow"):
            with self.assertRaises(server.ParamError):
                server.validate_params(q(date=bad), today=TODAY)

    def test_missing_date(self):
        with self.assertRaises(server.ParamError):
            server.validate_params(q(date=None), today=TODAY)

    def test_return_date_may_equal_but_not_precede_departure(self):
        server.validate_params(q(return_date="2026-12-07"), today=TODAY)
        with self.assertRaises(server.ParamError):
            server.validate_params(q(return_date="2026-12-06"), today=TODAY)

    def test_adults_range(self):
        server.validate_params(q(adults="9"), today=TODAY)
        for bad in ("0", "10", "-1", "x", "1.5"):
            with self.assertRaises(server.ParamError):
                server.validate_params(q(adults=bad), today=TODAY)

    def test_currency(self):
        self.assertEqual(server.validate_params(q(currency="gbp"), today=TODAY).currency, "GBP")
        with self.assertRaises(server.ParamError):
            server.validate_params(q(currency="EURO"), today=TODAY)

    def test_max_stops_blank_means_any(self):
        self.assertIsNone(server.validate_params(q(max_stops=""), today=TODAY).max_stops)
        self.assertEqual(server.validate_params(q(max_stops="0"), today=TODAY).max_stops, 0)
        with self.assertRaises(server.ParamError):
            server.validate_params(q(max_stops="4"), today=TODAY)


class Cache(unittest.TestCase):
    def test_hit_then_expiry_at_exactly_the_ttl(self):
        now = [100.0]
        cache = server.ResponseCache(600, clock=lambda: now[0])
        cache.put(("a",), {"v": 1})
        now[0] = 699.9
        self.assertEqual(cache.get(("a",)), {"v": 1})
        now[0] = 700.0
        self.assertIsNone(cache.get(("a",)))

    def test_evicts_the_oldest_when_full(self):
        now = [0.0]
        cache = server.ResponseCache(600, max_entries=2, clock=lambda: now[0])
        for index, key in enumerate("abc"):
            now[0] = float(index)
            cache.put((key,), index)
        self.assertIsNone(cache.get(("a",)))
        self.assertEqual(cache.get(("c",)), 2)


class ThrottleTests(unittest.TestCase):
    def test_spaces_calls_by_the_interval(self):
        now = [0.0]
        slept = []
        throttle = server.Throttle(3, clock=lambda: now[0], sleep=slept.append)
        self.assertEqual(throttle.acquire(), 0)
        self.assertEqual(throttle.acquire(), 3)
        self.assertEqual(slept, [3])

    def test_refuses_when_the_queue_is_too_long(self):
        throttle = server.Throttle(3, max_wait=5, clock=lambda: 0.0, sleep=lambda _: None)
        self.assertEqual(throttle.acquire(), 0)  # slot at 0
        self.assertEqual(throttle.acquire(), 3)  # slot at 3
        self.assertIsNone(throttle.acquire())  # would wait 6 > 5


def hop(frm, to, dep, arr, minutes):
    return NS(
        from_airport=NS(code=frm, name=frm + " airport"),
        to_airport=NS(code=to, name=to + " airport"),
        departure=NS(date=dep[0], time=dep[1]),
        arrival=NS(date=arr[0], time=arr[1]),
        duration=minutes,
        plane_type="Airbus A320",
    )


class Mapping(unittest.TestCase):
    def test_direct_flight(self):
        result = NS(type="OS", price=189, airlines=["Austrian"],
                    flights=[hop("VIE", "FCO", ((2026, 12, 7), (8, 5)), ((2026, 12, 7), (9, 50)), 105)],
                    carbon=NS(emission=95000, typical_on_route=102000))
        [offer] = server.flights_to_offers([result], "EUR")
        self.assertEqual(offer["price"], "189")
        self.assertEqual(offer["stops"], 0)
        self.assertEqual(offer["departs_at"], "2026-12-07T08:05")
        self.assertEqual(offer["arrives_at"], "2026-12-07T09:50")
        self.assertEqual(offer["duration_minutes"], 105)
        self.assertIsNone(offer["is_best"])

    def test_connection_adds_the_layover_at_the_same_airport(self):
        result = NS(type="multi", price=140, airlines=["A", "B"], carbon=None, flights=[
            hop("VIE", "MUC", ((2026, 12, 7), (6, 0)), ((2026, 12, 7), (7, 0)), 60),
            hop("MUC", "FCO", ((2026, 12, 7), (8, 30)), ((2026, 12, 7), (10, 15)), 105),
        ])
        [offer] = server.flights_to_offers([result], "EUR")
        self.assertEqual(offer["stops"], 1)
        self.assertEqual(offer["duration_minutes"], 60 + 90 + 105)

    def test_a_missing_leg_duration_makes_the_total_unknown_not_short(self):
        result = NS(type="x", price=140, airlines=["A"], carbon=None, flights=[
            hop("VIE", "FCO", ((2026, 12, 7), (6, 0)), ((2026, 12, 7), (7, 45)), None),
        ])
        [offer] = server.flights_to_offers([result], "EUR")
        self.assertIsNone(offer["duration_minutes"])

    def test_an_impossible_clock_face_is_null_and_a_zero_price_is_null(self):
        result = NS(type="x", price=0, airlines=[], carbon=None, flights=[
            hop("VIE", "FCO", ((2026, 12, 7), (25, 0)), ((2026, 12, 7), (7, 45)), 105),
        ])
        [offer] = server.flights_to_offers([result], "EUR")
        self.assertIsNone(offer["price"])
        self.assertIsNone(offer["departs_at"])

    def test_an_itinerary_with_no_segments_is_skipped(self):
        self.assertEqual(
            server.flights_to_offers([NS(type="x", price=1, airlines=[], flights=[], carbon=None)], "EUR"),
            [],
        )


class ServiceTests(unittest.TestCase):
    def make(self, fetch):
        return server.Service(fetch=fetch, throttle=server.Throttle(0, sleep=lambda _: None),
                              cache=server.ResponseCache(600))

    def test_second_identical_search_is_served_from_cache(self):
        calls = []
        service = self.make(lambda params: calls.append(params) or [])
        params = server.validate_params(q(), today=TODAY)
        self.assertFalse(service.search(params)["cached"])
        self.assertTrue(service.search(params)["cached"])
        self.assertEqual(len(calls), 1)

    def test_a_failure_is_not_cached(self):
        outcomes = [server.UpstreamError("consent_wall", "blocked", 503), []]

        def fetch(_params):
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        service = self.make(fetch)
        params = server.validate_params(q(), today=TODAY)
        with self.assertRaises(server.UpstreamError):
            service.search(params)
        self.assertFalse(service.search(params)["cached"])

    def test_response_carries_fetched_at_in_utc(self):
        service = self.make(lambda _p: [])
        body = service.search(server.validate_params(q(), today=TODAY))
        self.assertRegex(body["fetched_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


if __name__ == "__main__":
    unittest.main()
