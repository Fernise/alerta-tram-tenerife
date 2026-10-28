import json
import os
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import backup
import server


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        server._cache.clear()
        server._retry_after.clear()

    def test_cache_hit_keeps_timestamp(self):
        with patch.object(server, '_request_json', return_value=[] ) as request:
            first = server._fetch_cached('trams', 'unused')
            second = server._fetch_cached('trams', 'unused')
        self.assertEqual(first[1], 'MISS')
        self.assertEqual(second[1], 'HIT')
        self.assertEqual(first[2], second[2])
        self.assertEqual(request.call_count, 1)

    def test_stale_backoff_does_not_refresh_age_or_repeat_request(self):
        original = time.time() - 20
        server._cache['trams'] = (b'[]', time.monotonic() - 20, original)
        with patch.object(server, '_request_json', side_effect=OSError()) as request:
            first = server._fetch_cached('trams', 'unused')
            second = server._fetch_cached('trams', 'unused')
        self.assertEqual(first, (b'[]', 'STALE', original))
        self.assertEqual(second, first)
        self.assertEqual(request.call_count, 1)

    def test_expired_cache_fails_closed(self):
        server._cache['trams'] = (b'[]', time.monotonic() - 100, time.time() - 100)
        with patch.object(server, '_request_json', side_effect=OSError()):
            with self.assertRaises(OSError):
                server._fetch_cached('trams', 'unused')

    def test_stale_readings_not_used_for_history_or_push(self):
        now = time.time()
        recent = server.datetime.fromtimestamp(now - 10, server.timezone.utc).isoformat()
        old = server.datetime.fromtimestamp(now - 180, server.timezone.utc).isoformat()
        self.assertTrue(server._recent_occupancy({'sourceAt': recent}, now))
        for source in (old, None, 'bad', '2026-09-02T12:00:00'):
            self.assertFalse(server._recent_occupancy({'sourceAt': source}, now))

    def test_collector_refuses_stale_cache(self):
        with patch.object(server, '_fetch_cached', return_value=(b'[]', 'STALE', time.time())):
            with self.assertRaises(RuntimeError):
                server._collect_once()

    def test_readiness_not_just_process_alive(self):
        with patch.object(server, '_collector_state', {'lastSuccessAt': None, 'lastAttemptAt': None, 'error': None}):
            self.assertFalse(server._operational_status()['ready'])
        with patch.object(server, '_collector_state', {'lastSuccessAt': time.time(), 'lastAttemptAt': time.time(), 'error': None}):
            self.assertTrue(server._operational_status()['ready'])

    def test_backup_includes_wal_and_restores_without_touching_live(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'live.sqlite3'
            connection = sqlite3.connect(source)
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('CREATE TABLE occupancy_samples (sampled_at INTEGER, load INTEGER)')
            connection.execute('INSERT INTO occupancy_samples VALUES (1, 72)')
            connection.commit()
            destination = Path(folder) / 'backups'
            destination.mkdir()
            old = destination / 'occupancy-20260101T000000000000Z.sqlite3'
            old.touch()
            os.utime(old, (0, 0))
            unrelated = destination / 'keep.sqlite3'
            unrelated.touch()
            result = backup.verified_backup(source, destination)
            self.assertFalse(old.exists())
            self.assertTrue(unrelated.exists())
            self.assertEqual(result.stat().st_mode & 0o777, 0o600)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
            with sqlite3.connect(result) as restored:
                self.assertEqual(restored.execute('SELECT load FROM occupancy_samples').fetchone()[0], 72)
            self.assertEqual(connection.execute('SELECT load FROM occupancy_samples').fetchone()[0], 72)
            connection.close()
            self.assertEqual(json.loads((destination / 'last-backup.json').read_text())['restoreTest'], 'ok')

    def test_history_exposes_distinct_day_coverage_without_raw_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / 'history.sqlite3'
            with patch.object(server, 'HISTORY_DB', str(database)):
                # Compare the same local clock slot across DST, not a fixed UTC-hour offset.
                local_noon = datetime.now(server.CANARY).replace(hour=12, minute=0, second=0, microsecond=0) - timedelta(days=1)
                now = int(local_noon.timestamp())
                previous_week = int((local_noon - timedelta(days=7)).timestamp())
                with server._db() as connection:
                    connection.executemany(
                        """
                        INSERT INTO occupancy_samples
                        (sampled_at, source_at, service, vehicle, load, route, direction, next_stop, order_stop)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            (previous_week, None, '101', 1, 45, 1, 2, 'WEY', 1),
                            (now, None, '101', 1, 55, 1, 2, 'WEY', 1),
                        ],
                    )
                payload = json.loads(server._history(30, 1, 2, 30))

            self.assertEqual(payload['sampleCount'], 2)
            self.assertEqual(payload['observedDays'], 2)
            self.assertIsNotNone(payload['firstSampleAt'])
            self.assertIsNotNone(payload['lastSampleAt'])
            self.assertEqual(len(payload['points']), 1)
            self.assertEqual(payload['points'][0]['daysObserved'], 2)
            self.assertNotIn('service', payload['points'][0])


if __name__ == '__main__':
    unittest.main()
