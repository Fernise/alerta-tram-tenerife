#!/usr/bin/env python3
"""Private 30-day audit of published and real-time tram schedules."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import sqlite3
import statistics
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


CANARY = ZoneInfo("Atlantic/Canary")
DEFAULT_DB = Path("/var/lib/alerta-tram-relay/occupancy.sqlite3")
DEFAULT_STATE = Path("/var/lib/alerta-tram-relay/schedule-study")
DEFAULT_PROFILES = Path(__file__).with_name("schedule_profiles.json")
MAX_OBSERVATION_GAP_SECONDS = 180
GTFS_URL = (
    "https://datos.tenerife.es/ckan/dataset/"
    "4b83e018-37d9-40a6-b6d1-1df2b91c8117/resource/"
    "7b7bbd1f-f53a-4413-a6b4-ea411e18c66d/download/"
    "fichero-zip-de-google-transit.zip"
)
SOURCES = {
    "gtfs": GTFS_URL,
    "schedule-page": "https://metrotenerife.com/recorridos-y-horarios/",
    "l1-weekday-winter": "https://metrotenerife.com/wp-content/uploads/2024/03/Linea-1_L-V_Invierno.pdf",
    "l2-weekday-winter": "https://metrotenerife.com/wp-content/uploads/2024/03/Horarios-L2-INV-Copy.pdf",
    "l1-weekend-holiday": "https://metrotenerife.com/wp-content/uploads/2024/03/Linea-1_S-D_Festivos.pdf",
    "l2-weekend-holiday": "https://metrotenerife.com/wp-content/uploads/2024/03/Linea-2_S-D-Festivos.pdf",
}


def _secure_directory(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path, 0o700)


def _atomic_write(path: Path, content: bytes) -> None:
    _secure_directory(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=".schedule-study-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _download(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "User-Agent": "AlertaTramScheduleStudy/1.0 (authorized integration)",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"source returned {response.status}")
        return response.read()


def sync_sources(state_dir: Path) -> dict:
    source_dir = state_dir / "sources"
    _secure_directory(source_dir)
    captured_at = datetime.now(timezone.utc).isoformat()
    previous_by_name = {}
    previous_manifest = source_dir / "latest.json"
    if previous_manifest.exists():
        try:
            previous = json.loads(previous_manifest.read_text())
            previous_by_name = {item["name"]: item for item in previous.get("sources", [])}
        except (OSError, ValueError, KeyError, TypeError):
            previous_by_name = {}
    items = []
    errors = []
    for name, url in SOURCES.items():
        try:
            content = _download(url)
            digest = hashlib.sha256(content).hexdigest()
            suffix = ".zip" if name == "gtfs" else (".pdf" if url.endswith(".pdf") else ".html")
            filename = f"{name}-{digest[:16]}{suffix}"
            path = source_dir / filename
            if not path.exists():
                _atomic_write(path, content)
            items.append(
                {
                    "name": name,
                    "url": url,
                    "capturedAt": captured_at,
                    "sha256": digest,
                    "bytes": len(content),
                    "file": filename,
                }
            )
        except Exception as error:
            errors.append({"name": name, "url": url, "error": type(error).__name__})
            previous_item = previous_by_name.get(name)
            if previous_item and (source_dir / previous_item.get("file", "missing")).exists():
                items.append(previous_item)
    manifest = {"capturedAt": captured_at, "sources": items, "errors": errors}
    _atomic_write(source_dir / "latest.json", json.dumps(manifest, indent=2).encode())
    if not any(item["name"] == "gtfs" for item in items):
        raise RuntimeError("GTFS source could not be captured")
    return manifest


def _csv_from_zip(bundle: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with bundle.open(name) as raw:
        return list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")))


def _gtfs_time(value: str) -> int:
    hour, minute, second = (int(part) for part in value.split(":"))
    return hour * 60 + minute + (1 if second >= 30 else 0)


def _gtfs_date(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def audit_gtfs(path: Path, study_start: date, study_end: date) -> dict:
    required = {"calendar.txt", "calendar_dates.txt", "frequencies.txt", "trips.txt", "stops.txt"}
    with zipfile.ZipFile(path) as bundle:
        names = set(bundle.namelist())
        missing = sorted(required - names)
        if missing:
            raise ValueError("GTFS missing required files: " + ", ".join(missing))
        calendar = _csv_from_zip(bundle, "calendar.txt")
        exceptions = _csv_from_zip(bundle, "calendar_dates.txt")
        trips = _csv_from_zip(bundle, "trips.txt")
        frequencies = _csv_from_zip(bundle, "frequencies.txt")
        stops = _csv_from_zip(bundle, "stops.txt")

    calendars = {}
    for row in calendar:
        calendars[row["service_id"]] = {
            "start": _gtfs_date(row["start_date"]),
            "end": _gtfs_date(row["end_date"]),
            "weekdays": [
                row[key] == "1"
                for key in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
            ],
        }
    exception_map = defaultdict(dict)
    for row in exceptions:
        exception_map[_gtfs_date(row["date"])][row["service_id"]] = row["exception_type"]

    covered_dates = []
    cursor = study_start
    while cursor <= study_end:
        active = set()
        for service, rules in calendars.items():
            if rules["start"] <= cursor <= rules["end"] and rules["weekdays"][cursor.weekday()]:
                active.add(service)
        for service, exception_type in exception_map.get(cursor, {}).items():
            if exception_type == "1":
                active.add(service)
            elif exception_type == "2":
                active.discard(service)
        if active:
            covered_dates.append(cursor.isoformat())
        cursor += timedelta(days=1)

    trip_by_id = {row["trip_id"]: row for row in trips}
    periods = []
    for row in frequencies:
        trip = trip_by_id.get(row["trip_id"])
        if not trip or trip.get("route_id") not in {"L1", "L2"}:
            continue
        service = calendars.get(trip["service_id"])
        if not service:
            continue
        day_types = set()
        for weekday, active in enumerate(service["weekdays"]):
            if not active:
                continue
            day_types.add("weekday" if weekday < 5 else ("saturday" if weekday == 5 else "sunday_holiday"))
        for day_type in sorted(day_types):
            periods.append(
                {
                    "route": int(trip["route_id"][1:]),
                    "dayType": day_type,
                    "startMinute": _gtfs_time(row["start_time"]),
                    "endMinute": _gtfs_time(row["end_time"]),
                    "targetMinutes": int(row["headway_secs"]) / 60,
                    "exactTimes": row.get("exact_times") or None,
                }
            )
    end_dates = [rules["end"] for rules in calendars.values()]
    start_dates = [rules["start"] for rules in calendars.values()]
    return {
        "file": str(path),
        "calendarStart": min(start_dates).isoformat() if start_dates else None,
        "calendarEnd": max(end_dates).isoformat() if end_dates else None,
        "studyDays": (study_end - study_start).days + 1,
        "coveredStudyDays": len(covered_dates),
        "validForWholeStudy": len(covered_dates) == (study_end - study_start).days + 1,
        "calendarExpiredBeforeStudy": bool(end_dates and max(end_dates) < study_start),
        "calendarDateExceptions": len(exceptions),
        "frequencyRows": len(frequencies),
        "frequencyRowsWithExactTimes": sum(1 for row in frequencies if row.get("exact_times") == "1"),
        "tripRows": len(trips),
        "stopRows": len(stops),
        "periods": periods,
    }


def _load_observations(database: Path, start_at: int, end_at: int) -> list[sqlite3.Row]:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(
            """
            SELECT sampled_at, retrieved_at, service, route, direction, latitude,
                   longitude, remaining_minutes, next_stop, destination_stop, order_stop
            FROM tram_observations
            WHERE sampled_at >= ? AND sampled_at < ?
            ORDER BY service, sampled_at
            """,
            (start_at, end_at),
        ).fetchall()
    finally:
        connection.close()


def _load_runs(database: Path, start_at: int, end_at: int) -> list[sqlite3.Row]:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(
            """
            SELECT sampled_at, retrieved_at, raw_count, valid_count, invalid_count,
                   duplicate_services
            FROM tram_collection_runs
            WHERE sampled_at >= ? AND sampled_at < ? ORDER BY sampled_at
            """,
            (start_at, end_at),
        ).fetchall()
    finally:
        connection.close()


def derive_events(observations: list[sqlite3.Row]) -> list[dict]:
    by_service = defaultdict(list)
    for row in observations:
        by_service[row["service"]].append(row)
    events = []
    for service, rows in by_service.items():
        segment = []
        previous = None
        for row in rows:
            if previous is None:
                segment = [row]
                previous = row
                continue
            continuous = (
                0 < row["sampled_at"] - previous["sampled_at"] <= MAX_OBSERVATION_GAP_SECONDS
                and row["route"] == previous["route"]
                and row["direction"] == previous["direction"]
            )
            if continuous and row["next_stop"] != previous["next_stop"]:
                event_at = (previous["sampled_at"] + row["sampled_at"]) // 2
                predictions = []
                for sample in segment:
                    remaining = sample["remaining_minutes"]
                    if remaining is None or remaining < 0 or remaining > 15:
                        continue
                    predictions.append(
                        {
                            "sampledAt": sample["sampled_at"],
                            "remainingMinutes": remaining,
                            "errorMinutes": (sample["sampled_at"] + remaining * 60 - event_at) / 60,
                        }
                    )
                events.append(
                    {
                        "eventAt": event_at,
                        "uncertaintySeconds": (row["sampled_at"] - previous["sampled_at"]) / 2,
                        "service": service,
                        "route": previous["route"],
                        "direction": previous["direction"],
                        "stop": previous["next_stop"],
                        "predictions": predictions,
                    }
                )
                segment = [row]
            elif continuous and row["next_stop"] == previous["next_stop"]:
                segment.append(row)
            else:
                segment = [row]
            previous = row
    return events


def _coverage_between(run_minutes: set[int], start_at: int, end_at: int) -> float:
    start_minute = start_at // 60
    end_minute = end_at // 60
    expected = max(1, end_minute - start_minute + 1)
    present = sum(1 for minute in range(start_minute, end_minute + 1) if minute in run_minutes)
    return present / expected


def derive_headways(events: list[dict], runs: list[sqlite3.Row]) -> list[dict]:
    run_minutes = {row["sampled_at"] // 60 for row in runs}
    groups = defaultdict(list)
    for event in events:
        local = datetime.fromtimestamp(event["eventAt"], timezone.utc).astimezone(CANARY)
        key = (local.date().isoformat(), event["route"], event["direction"], event["stop"])
        groups[key].append(event)
    headways = []
    for (_, route, direction, stop), rows in groups.items():
        ordered = sorted(rows, key=lambda item: item["eventAt"])
        for previous, current in zip(ordered, ordered[1:]):
            minutes = (current["eventAt"] - previous["eventAt"]) / 60
            if 2 <= minutes <= 60 and _coverage_between(run_minutes, previous["eventAt"], current["eventAt"]) >= 0.8:
                headways.append(
                    {
                        "eventAt": current["eventAt"],
                        "route": route,
                        "direction": direction,
                        "stop": stop,
                        "minutes": minutes,
                    }
                )
    return headways


def _day_type(local_date: date, holidays: set[str]) -> str:
    if local_date.isoformat() in holidays or local_date.weekday() == 6:
        return "sunday_holiday"
    return "saturday" if local_date.weekday() == 5 else "weekday"


def _website_target(profile: dict, route: int, local: datetime) -> float | None:
    day_type = _day_type(local.date(), set(profile.get("holidayDates", [])))
    key = "weekday_winter" if day_type == "weekday" else day_type
    minute = local.hour * 60 + local.minute
    for start, end, target in profile["profiles"].get(key, {}).get(str(route), []):
        if start <= minute < end:
            return float(target)
    return None


def _gtfs_target(audit: dict, route: int, local: datetime) -> float | None:
    day_type = "weekday" if local.weekday() < 5 else ("saturday" if local.weekday() == 5 else "sunday_holiday")
    minute = local.hour * 60 + local.minute
    candidates = [
        period["targetMinutes"]
        for period in audit.get("periods", [])
        if period["route"] == route
        and period["dayType"] == day_type
        and period["startMinute"] <= minute < period["endMinute"]
    ]
    return statistics.median(candidates) if candidates else None


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, round((len(ordered) - 1) * fraction))
    return ordered[index]


def compare_headways(headways: list[dict], target_getter) -> dict:
    matched = []
    for item in headways:
        local = datetime.fromtimestamp(item["eventAt"], timezone.utc).astimezone(CANARY)
        target = target_getter(item["route"], local)
        if target is None:
            continue
        matched.append((item["minutes"], target))
    errors = [observed - target for observed, target in matched]
    absolute = [abs(error) for error in errors]
    return {
        "matchedHeadways": len(matched),
        "medianObservedMinutes": _round(statistics.median([value for value, _ in matched])) if matched else None,
        "medianPublishedMinutes": _round(statistics.median([target for _, target in matched])) if matched else None,
        "medianAbsoluteErrorMinutes": _round(statistics.median(absolute)) if absolute else None,
        "p90AbsoluteErrorMinutes": _round(_percentile(absolute, 0.9)),
        "withinTwoMinutesPercent": _round(100 * sum(error <= 2 for error in absolute) / len(absolute)) if absolute else None,
        "serviceGapPercent": _round(100 * sum(observed > target * 1.5 for observed, target in matched) / len(matched)) if matched else None,
    }


def prediction_metrics(events: list[dict]) -> dict:
    buckets = {"0-2": [], "3-5": [], "6-10": []}
    for event in events:
        selected = {}
        for prediction in event["predictions"]:
            lead = prediction["remainingMinutes"]
            bucket = "0-2" if lead <= 2 else ("3-5" if lead <= 5 else ("6-10" if lead <= 10 else None))
            if bucket is None:
                continue
            current = selected.get(bucket)
            midpoint = {"0-2": 1, "3-5": 4, "6-10": 8}[bucket]
            if current is None or abs(lead - midpoint) < abs(current["remainingMinutes"] - midpoint):
                selected[bucket] = prediction
        for bucket, prediction in selected.items():
            buckets[bucket].append(prediction["errorMinutes"])
    output = {}
    for bucket, errors in buckets.items():
        absolute = [abs(value) for value in errors]
        output[bucket] = {
            "predictions": len(errors),
            "biasMinutes": _round(statistics.median(errors)) if errors else None,
            "medianAbsoluteErrorMinutes": _round(statistics.median(absolute)) if errors else None,
            "withinOneMinutePercent": _round(100 * sum(value <= 1 for value in absolute) / len(absolute)) if absolute else None,
            "withinTwoMinutesPercent": _round(100 * sum(value <= 2 for value in absolute) / len(absolute)) if absolute else None,
        }
    return output


def quality_metrics(observations: list[sqlite3.Row], runs: list[sqlite3.Row], start_at: int, end_at: int) -> dict:
    expected_minutes = max(1, (end_at - start_at) // 60)
    valid = sum(row["valid_count"] for row in runs)
    invalid = sum(row["invalid_count"] for row in runs)
    out_of_area = sum(
        1
        for row in observations
        if not (28.3 <= row["latitude"] <= 28.6 and -16.5 <= row["longitude"] <= -16.1)
    )
    gaps = sum(
        1 for previous, current in zip(runs, runs[1:])
        if current["sampled_at"] - previous["sampled_at"] > 90
    )
    days = {
        datetime.fromtimestamp(row["sampled_at"], timezone.utc).astimezone(CANARY).date().isoformat()
        for row in runs
    }
    return {
        "collectionRuns": len(runs),
        "expectedMinuteSlots": expected_minutes,
        "collectionCoveragePercent": _round(100 * len(runs) / expected_minutes),
        "collectionGaps": gaps,
        "observedDays": len(days),
        "observations": len(observations),
        "distinctServices": len({row["service"] for row in observations}),
        "validFeedRows": valid,
        "invalidFeedRows": invalid,
        "duplicateServiceRows": sum(row["duplicate_services"] for row in runs),
        "outOfTenerifeCoordinates": out_of_area,
        "missingEtaRows": sum(row["remaining_minutes"] is None for row in observations),
    }


def _latest_gtfs(state_dir: Path) -> Path | None:
    manifest_path = state_dir / "sources" / "latest.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text())
    for item in manifest.get("sources", []):
        if item.get("name") == "gtfs":
            candidate = manifest_path.parent / item["file"]
            return candidate if candidate.exists() else None
    return None


def build_report(database: Path, profiles_path: Path, state_dir: Path, days: int = 30) -> dict:
    now = datetime.now(timezone.utc)
    end_at = int(now.timestamp())
    start_at = int((now - timedelta(days=days)).timestamp())
    study_start = datetime.fromtimestamp(start_at, timezone.utc).astimezone(CANARY).date()
    study_end = now.astimezone(CANARY).date()
    profile = json.loads(profiles_path.read_text())
    observations = _load_observations(database, start_at, end_at)
    runs = _load_runs(database, start_at, end_at)
    events = derive_events(observations)
    headways = derive_headways(events, runs)
    quality = quality_metrics(observations, runs, start_at, end_at)

    gtfs_path = _latest_gtfs(state_dir)
    gtfs = audit_gtfs(gtfs_path, study_start, study_end) if gtfs_path else None
    website = compare_headways(headways, lambda route, local: _website_target(profile, route, local))
    gtfs_comparison = compare_headways(
        headways, lambda route, local: _gtfs_target(gtfs, route, local)
    ) if gtfs else None
    span_days = 0
    if runs:
        span_days = (runs[-1]["sampled_at"] - runs[0]["sampled_at"]) / 86400
    complete = span_days >= 29 and (quality["collectionCoveragePercent"] or 0) >= 90
    return {
        "privateStudy": True,
        "generatedAt": now.isoformat(),
        "window": {"days": days, "from": study_start.isoformat(), "to": study_end.isoformat()},
        "status": "complete" if complete else "provisional",
        "method": {
            "grain": "one row per visible service per minute",
            "arrivalInference": "midpoint between the last sample naming a stop as next and the first sample naming another stop",
            "arrivalUncertaintySeconds": "normally ±30; transitions with collection gaps over 180 seconds are excluded",
            "headwayComparison": "observed time between consecutive vehicles at the same stop, line and direction",
            "etaComparison": "official remainingMinutes prediction versus inferred stop transition",
            "limitations": [
                "The live endpoint provides retrieval-time positions, not a signed GPS observation timestamp.",
                "Frequency-based GTFS without exact_times does not define exact departures.",
                "Vehicle positions are evidence of the published feed, not an independent platform observer.",
            ],
        },
        "quality": quality,
        "derived": {"stopTransitions": len(events), "headways": len(headways)},
        "realtimeEta": prediction_metrics(events),
        "publishedWebsite": {
            "source": profile["source"],
            "comparison": website,
        },
        "gtfs": {
            "audit": gtfs,
            "comparison": gtfs_comparison,
            "interpretation": (
                "expired_reference_only" if gtfs and gtfs["calendarExpiredBeforeStudy"]
                else ("current_reference" if gtfs else "source_unavailable")
            ),
        },
    }


def render_markdown(report: dict) -> str:
    quality = report["quality"]
    web = report["publishedWebsite"]["comparison"]
    gtfs = report["gtfs"]
    lines = [
        "# Estudio privado de fiabilidad horaria · Alerta Tram",
        "",
        f"Estado: **{report['status']}** · Ventana: {report['window']['from']} a {report['window']['to']}",
        "",
        "## Calidad de la captura",
        "",
        f"- Cobertura del recolector: {quality['collectionCoveragePercent']}% ({quality['collectionRuns']} de {quality['expectedMinuteSlots']} minutos).",
        f"- Observaciones: {quality['observations']} · días observados: {quality['observedDays']} · servicios distintos: {quality['distinctServices']}.",
        f"- Filas inválidas: {quality['invalidFeedRows']} · duplicadas: {quality['duplicateServiceRows']} · coordenadas fuera de Tenerife: {quality['outOfTenerifeCoordinates']}.",
        "",
        "## Frecuencia real frente a la web oficial",
        "",
        f"- Intervalos comparables: {web['matchedHeadways']}.",
        f"- Error absoluto mediano: {web['medianAbsoluteErrorMinutes']} min · P90: {web['p90AbsoluteErrorMinutes']} min.",
        f"- Dentro de ±2 min: {web['withinTwoMinutesPercent']}% · huecos >1,5× lo publicado: {web['serviceGapPercent']}%.",
        "",
        "## Predicción en tiempo real «llega en X min»",
        "",
    ]
    for bucket, metrics in report["realtimeEta"].items():
        lines.append(
            f"- Antelación {bucket} min: n={metrics['predictions']}, error absoluto mediano "
            f"{metrics['medianAbsoluteErrorMinutes']} min, dentro de ±1 min {metrics['withinOneMinutePercent']}%."
        )
    lines.extend(["", "## GTFS", ""])
    audit = gtfs["audit"]
    if audit:
        lines.append(
            f"- Calendario: {audit['calendarStart']} a {audit['calendarEnd']} · cobertura de la ventana: "
            f"{audit['coveredStudyDays']}/{audit['studyDays']} días."
        )
        lines.append(
            f"- Uso en el análisis: **{gtfs['interpretation']}**. Frecuencias con `exact_times=1`: "
            f"{audit['frequencyRowsWithExactTimes']}/{audit['frequencyRows']}."
        )
        comparison = gtfs["comparison"]
        lines.append(
            f"- Comparación informativa con sus frecuencias: n={comparison['matchedHeadways']}, "
            f"error absoluto mediano {comparison['medianAbsoluteErrorMinutes']} min."
        )
    else:
        lines.append("- No había una copia GTFS disponible; el informe se generó sin esa referencia.")
    lines.extend(
        [
            "",
            "## Límites de interpretación",
            "",
            "La transición de parada tiene una incertidumbre aproximada de ±30 s con captura continua. "
            "Los intervalos atravesados por fallos relevantes del recolector se excluyen. El feed en vivo "
            "es la realidad publicada por Metrotenerife, no una observación física independiente en el andén.",
            "",
        ]
    )
    return "\n".join(lines)


def save_report(report: dict, output_dir: Path) -> None:
    _secure_directory(output_dir)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_bytes = json.dumps(report, ensure_ascii=False, indent=2).encode()
    markdown_bytes = render_markdown(report).encode()
    _atomic_write(output_dir / f"report-{stamp}.json", json_bytes)
    _atomic_write(output_dir / f"report-{stamp}.md", markdown_bytes)
    _atomic_write(output_dir / "latest.json", json_bytes)
    _atomic_write(output_dir / "latest.md", markdown_bytes)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("sync", "report", "daily", "status"))
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--profiles", type=Path, default=DEFAULT_PROFILES)
    parser.add_argument("--days", type=int, default=30)
    args = parser.parse_args()
    os.umask(0o077)

    if args.command in {"sync", "daily"}:
        try:
            manifest = sync_sources(args.state_dir)
            print(json.dumps({"sourceSync": "ok", "sources": len(manifest["sources"]), "errors": manifest["errors"]}))
        except Exception as error:
            if args.command == "sync":
                raise
            print(json.dumps({"sourceSync": "failed", "error": type(error).__name__}))
    if args.command in {"report", "daily", "status"}:
        report = build_report(args.db, args.profiles, args.state_dir, args.days)
        if args.command != "status":
            save_report(report, args.state_dir / "reports")
        summary = {
            "status": report["status"],
            "window": report["window"],
            "coveragePercent": report["quality"]["collectionCoveragePercent"],
            "observations": report["quality"]["observations"],
            "stopTransitions": report["derived"]["stopTransitions"],
            "gtfsInterpretation": report["gtfs"]["interpretation"],
        }
        print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
