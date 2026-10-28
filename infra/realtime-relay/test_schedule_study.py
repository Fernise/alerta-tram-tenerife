import csv
import io
import json
import sqlite3
import tempfile
import time
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

import schedule_study
import server


class ScheduleStudyTests(unittest.TestCase):
    def test_private_collector_records_valid_vehicle_rows_and_quality(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "study.sqlite3"
            sampled_at = int(time.time() // 60 * 60)
            payload = [
                {
                    "service": "101",
                    "route": 1,
                    "direction": 2,
                    "coordinate": {"lat": 28.46, "lon": -16.25},
                    "remainingMinutes": 3,
                    "nextStop": "WEY",
                    "destinationStop": "INT",
                    "orderStop": 4,
                },
                {"service": "101", "route": 1, "direction": 2, "coordinate": {}},
                {"service": "", "route": 1, "direction": 2},
                "malformed-row",
            ]
            with patch.object(server, "HISTORY_DB", str(database)):
                stored = server._store_tram_observations(payload, sampled_at, sampled_at + 1.5)
                with server._db() as connection:
                    observations = connection.execute("SELECT * FROM tram_observations").fetchall()
                    run = connection.execute("SELECT * FROM tram_collection_runs").fetchone()

            self.assertEqual(stored, 1)
            self.assertEqual(len(observations), 1)
            self.assertEqual(observations[0]["remaining_minutes"], 3)
            self.assertEqual(run["raw_count"], 4)
            self.assertEqual(run["valid_count"], 1)
            self.assertEqual(run["invalid_count"], 3)
            self.assertEqual(run["duplicate_services"], 1)

    def test_stop_transitions_produce_headway_and_eta_error(self):
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.execute(
            """
            CREATE TABLE observations (
                sampled_at INTEGER, retrieved_at REAL, service TEXT, route INTEGER,
                direction INTEGER, latitude REAL, longitude REAL,
                remaining_minutes INTEGER, next_stop TEXT,
                destination_stop TEXT, order_stop INTEGER
            )
            """
        )
        base = 1_800_000_000
        rows = []
        for service, offset in (("101", 0), ("102", 300)):
            rows.extend(
                [
                    (base + offset, base + offset, service, 1, 2, 28.46, -16.25, 2, "WEY", "INT", 4),
                    (base + offset + 60, base + offset + 60, service, 1, 2, 28.46, -16.25, 1, "WEY", "INT", 4),
                    (base + offset + 120, base + offset + 120, service, 1, 2, 28.46, -16.25, 4, "PAZ", "INT", 5),
                ]
            )
        connection.executemany("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        observations = connection.execute("SELECT * FROM observations ORDER BY service, sampled_at").fetchall()
        events = schedule_study.derive_events(observations)
        run_rows = []
        connection.execute(
            "CREATE TABLE runs (sampled_at INTEGER, retrieved_at REAL, raw_count INTEGER, valid_count INTEGER, invalid_count INTEGER, duplicate_services INTEGER)"
        )
        for timestamp in range(base, base + 421, 60):
            connection.execute("INSERT INTO runs VALUES (?, ?, 2, 2, 0, 0)", (timestamp, timestamp))
        run_rows = connection.execute("SELECT * FROM runs ORDER BY sampled_at").fetchall()
        headways = schedule_study.derive_headways(events, run_rows)
        eta = schedule_study.prediction_metrics(events)
        connection.close()

        self.assertEqual(len(events), 2)
        self.assertEqual(len(headways), 1)
        self.assertEqual(headways[0]["minutes"], 5)
        self.assertEqual(eta["0-2"]["predictions"], 2)
        self.assertEqual(eta["0-2"]["medianAbsoluteErrorMinutes"], 0.5)

    def test_gtfs_audit_rejects_expired_calendar_as_current_reference(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "gtfs.zip"
            files = {
                "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS1,1,1,1,1,1,0,0,20240101,20250715\n",
                "calendar_dates.txt": "service_id,date,exception_type\n",
                "trips.txt": "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\nL1,S1,IT,Trinidad,0,S1\n",
                "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nIT,6:00:00,7:00:00,900\n",
                "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n01,Intercambiador,28.45,-16.25\n",
            }
            with zipfile.ZipFile(target, "w") as bundle:
                for name, content in files.items():
                    bundle.writestr(name, content)
            audit = schedule_study.audit_gtfs(target, date(2026, 9, 13), date(2026, 10, 13))

        self.assertTrue(audit["calendarExpiredBeforeStudy"])
        self.assertFalse(audit["validForWholeStudy"])
        self.assertEqual(audit["coveredStudyDays"], 0)
        self.assertEqual(audit["frequencyRowsWithExactTimes"], 0)

    def test_report_files_are_private(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "reports"
            report = {
                "status": "provisional",
                "window": {"from": "2026-09-13", "to": "2026-10-13"},
                "quality": {
                    "collectionCoveragePercent": 0,
                    "collectionRuns": 0,
                    "expectedMinuteSlots": 43200,
                    "observations": 0,
                    "observedDays": 0,
                    "distinctServices": 0,
                    "invalidFeedRows": 0,
                    "duplicateServiceRows": 0,
                    "outOfTenerifeCoordinates": 0,
                },
                "publishedWebsite": {"comparison": {"matchedHeadways": 0, "medianAbsoluteErrorMinutes": None, "p90AbsoluteErrorMinutes": None, "withinTwoMinutesPercent": None, "serviceGapPercent": None}},
                "realtimeEta": {"0-2": {"predictions": 0, "medianAbsoluteErrorMinutes": None, "withinOneMinutePercent": None}},
                "gtfs": {"audit": None, "interpretation": "source_unavailable", "comparison": None},
            }
            schedule_study.save_report(report, output)
            latest = output / "latest.json"
            self.assertEqual(latest.stat().st_mode & 0o777, 0o600)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual(json.loads(latest.read_text())["status"], "provisional")


if __name__ == "__main__":
    unittest.main()
