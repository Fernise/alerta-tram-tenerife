#!/usr/bin/env python3
"""Authenticated cache and historical collector for TranviaOnline data."""

from __future__ import annotations

import hmac
import json
import os
import sqlite3
import statistics
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo


VENDOR_DIR = os.environ.get(
    "RELAY_VENDOR_DIR", os.path.join(os.path.dirname(__file__), "vendor")
)
if os.path.isdir(VENDOR_DIR):
    sys.path.insert(0, VENDOR_DIR)

try:
    from pywebpush import WebPushException, webpush
except ImportError:  # The relay still serves live data when push is not configured.
    WebPushException = Exception  # type: ignore[assignment,misc]
    webpush = None


TRAMS_URL = "https://tranviaonline.metrotenerife.com/api/infoStops/vehicleLocation"
OCCUPANCY_URL = "https://tranviaonline.metrotenerife.com/api/cargaVehiculo"
HOST = os.environ.get("RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("RELAY_PORT", "8787"))
TOKEN = os.environ.get("RELAY_TOKEN", "")
HISTORY_DB = os.environ.get(
    "HISTORY_DB", "/var/lib/alerta-tram-relay/occupancy.sqlite3"
)
HISTORY_ENABLED = os.environ.get("HISTORY_ENABLED", "1") == "1"
COLLECT_SECONDS = max(30, int(os.environ.get("COLLECT_SECONDS", "60")))
CACHE_SECONDS = 8
STALE_SECONDS = 90
UPSTREAM_TIMEOUT_SECONDS = 8
RETENTION_DAYS = 90
CANARY = ZoneInfo("Atlantic/Canary")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@alerta-tram.invalid").strip()
PUSH_ENABLED = bool(webpush and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and VAPID_SUBJECT)
PUSH_COOLDOWN_SECONDS = 30 * 60
PUSH_TEST_COOLDOWN_SECONDS = 5 * 60
PUSH_RETENTION_DAYS = 180

_cache: dict[str, tuple[bytes, float, float]] = {}
_cache_lock = threading.Lock()
_retry_after: dict[str, float] = {}
_collector_state: dict = {"lastSuccessAt": None, "lastAttemptAt": None, "error": None}


class PushTestCooldown(Exception):
    pass


def _request_json(url: str) -> list[dict]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "User-Agent": "AlertaTramRelay/2.0 (authorized integration)",
        },
    )
    with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"upstream returned {response.status}")
        payload = json.loads(response.read())
        if not isinstance(payload, list):
            raise RuntimeError("unexpected upstream payload")
        return payload


def _fetch_cached(key: str, url: str) -> tuple[bytes, str, float]:
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and now - cached[1] < CACHE_SECONDS:
        return cached[0], "HIT", cached[2]

    with _cache_lock:
        now = time.monotonic()
        cached = _cache.get(key)
        if cached is not None and now - cached[1] < CACHE_SECONDS:
            return cached[0], "HIT", cached[2]
        if now < _retry_after.get(key, 0):
            if cached is not None and now - cached[1] < STALE_SECONDS:
                return cached[0], "STALE", cached[2]
            raise RuntimeError("upstream_backoff")
        try:
            payload = _request_json(url)
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            fetched_at = time.time()
            _cache[key] = (body, time.monotonic(), fetched_at)
            _retry_after.pop(key, None)
            return body, "MISS", fetched_at
        except (OSError, ValueError, RuntimeError, urllib.error.URLError):
            _retry_after[key] = time.monotonic() + CACHE_SECONDS
            cached = _cache.get(key)
            if cached is not None and time.monotonic() - cached[1] < STALE_SECONDS:
                return cached[0], "STALE", cached[2]
            raise


def _as_int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _as_float(value: object) -> float | None:
    try:
        parsed = float(value)  # type: ignore[arg-type]
        return parsed if parsed == parsed and abs(parsed) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _source_timestamp(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.strptime(value.strip(), "%d/%m/%Y %H:%M:%S")
        return parsed.replace(tzinfo=CANARY).astimezone(timezone.utc).isoformat()
    except ValueError:
        return value.strip()


def _normalized_load(raw_load: int) -> int:
    """Match TranviaOnline's public getCargaNormalizada scale."""
    thresholds = (
        (5, 3), (8, 7), (11, 10), (14, 14), (17, 18), (20, 22),
        (23, 25), (26, 29), (29, 33), (32, 36), (35, 40), (38, 44),
        (41, 48), (44, 51), (47, 55), (50, 59), (53, 62), (56, 66),
        (59, 70), (62, 74), (65, 77), (68, 81), (71, 85), (74, 89),
        (77, 92), (80, 96),
    )
    for upper_bound, percentage in thresholds:
        if raw_load < upper_bound:
            return percentage
    return 100


def _normalize_occupancy(payload: list[dict]) -> list[dict]:
    rows: list[dict] = []
    for item in payload:
        service = str(item.get("SERVICIO", "")).strip()
        raw_load = _as_int(item.get("CARGA"))
        if not service or raw_load is None:
            continue
        rows.append(
            {
                "service": service,
                "vehicle": _as_int(item.get("VEHICULO")),
                "load": _normalized_load(max(0, raw_load)),
                "rawLoad": max(0, raw_load),
                "sourceAt": _source_timestamp(item.get("FECHA")),
            }
        )
    return rows


def _occupancy_response() -> tuple[bytes, str, float]:
    raw, cache_status, fetched_at = _fetch_cached("occupancy", OCCUPANCY_URL)
    body = json.dumps(
        {
            "source": "Metrotenerife · TranvíaOnline",
            "fetchedAt": datetime.fromtimestamp(fetched_at, timezone.utc).isoformat(),
            "stale": cache_status == "STALE",
            "occupancy": _normalize_occupancy(json.loads(raw)),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    return body, cache_status, fetched_at


def _recent_occupancy(item: dict, now: float) -> bool:
    try:
        source = datetime.fromisoformat(item.get("sourceAt") or "")
        if source.tzinfo is None:
            return False
        age = now - source.timestamp()
        return -5 <= age < 120
    except (ValueError, TypeError):
        return False


def _operational_status() -> dict:
    now = time.time()
    collector = dict(_collector_state)
    last_success = collector["lastSuccessAt"]
    collector_ok = bool(HISTORY_ENABLED and last_success is not None
                        and -5 <= now - last_success < max(180, COLLECT_SECONDS * 3)
                        and collector["error"] is None)
    backup = {"status": "missing", "verifiedAt": None}
    try:
        path = os.path.join(os.path.dirname(HISTORY_DB), "backups", "last-backup.json")
        with open(path, encoding="utf-8") as handle:
            metadata = json.loads(handle.read(4096))
        verified = float(metadata["verifiedAt"])
        backup = {"status": "ok" if -5 <= now - verified < 36 * 3600 else "overdue",
                  "verifiedAt": verified}
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return {"ready": collector_ok, "collector": collector, "backup": backup,
            "checkedAt": now, "pushConfigured": PUSH_ENABLED}


def _db() -> sqlite3.Connection:
    connection = sqlite3.connect(HISTORY_DB, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS occupancy_samples (
            sampled_at INTEGER NOT NULL,
            source_at TEXT,
            service TEXT NOT NULL,
            vehicle INTEGER,
            load INTEGER NOT NULL,
            route INTEGER,
            direction INTEGER,
            next_stop TEXT,
            order_stop INTEGER,
            PRIMARY KEY (sampled_at, service)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_samples_route_time "
        "ON occupancy_samples(route, direction, sampled_at)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS tram_observations (
            sampled_at INTEGER NOT NULL,
            retrieved_at REAL NOT NULL,
            service TEXT NOT NULL,
            route INTEGER NOT NULL CHECK (route IN (1, 2)),
            direction INTEGER NOT NULL CHECK (direction IN (1, 2)),
            latitude REAL,
            longitude REAL,
            remaining_minutes INTEGER,
            next_stop TEXT NOT NULL,
            destination_stop TEXT,
            order_stop INTEGER,
            PRIMARY KEY (sampled_at, service)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_tram_observations_stop_time "
        "ON tram_observations(route, direction, next_stop, sampled_at)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS tram_collection_runs (
            sampled_at INTEGER PRIMARY KEY,
            retrieved_at REAL NOT NULL,
            raw_count INTEGER NOT NULL,
            valid_count INTEGER NOT NULL,
            invalid_count INTEGER NOT NULL,
            duplicate_services INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS relay_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            endpoint TEXT PRIMARY KEY,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            route INTEGER NOT NULL,
            direction INTEGER NOT NULL,
            threshold INTEGER NOT NULL,
            quiet_start TEXT NOT NULL,
            quiet_end TEXT NOT NULL,
            language TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            last_notified_at INTEGER NOT NULL DEFAULT 0,
            last_service TEXT,
            last_tested_at INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    push_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(push_subscriptions)")
    }
    if "last_tested_at" not in push_columns:
        connection.execute(
            "ALTER TABLE push_subscriptions ADD COLUMN last_tested_at INTEGER NOT NULL DEFAULT 0"
        )
    migrated = connection.execute(
        "SELECT value FROM relay_meta WHERE key = 'normalized_load_v1'"
    ).fetchone()
    if migrated is None:
        previous = connection.execute("SELECT sampled_at, service, load FROM occupancy_samples").fetchall()
        connection.executemany(
            "UPDATE occupancy_samples SET load = ? WHERE sampled_at = ? AND service = ?",
            [(_normalized_load(row["load"]), row["sampled_at"], row["service"]) for row in previous],
        )
        connection.execute(
            "INSERT INTO relay_meta(key, value) VALUES ('normalized_load_v1', '1')"
        )
    connection.execute("PRAGMA optimize")
    return connection


def _store_tram_observations(
    trams: list[dict], sampled_at: int, retrieved_at: float
) -> int:
    rows: list[tuple] = []
    seen_services: set[str] = set()
    invalid_count = 0
    duplicate_services = 0
    for item in trams:
        if not isinstance(item, dict):
            invalid_count += 1
            continue
        service = str(item.get("service", "")).strip()
        route = _as_int(item.get("route"))
        direction = _as_int(item.get("direction"))
        coordinate = item.get("coordinate")
        latitude = _as_float(coordinate.get("lat")) if isinstance(coordinate, dict) else None
        longitude = _as_float(coordinate.get("lon")) if isinstance(coordinate, dict) else None
        next_stop = str(item.get("nextStop", "")).strip()
        if (
            not service
            or service in seen_services
            or route not in {1, 2}
            or direction not in {1, 2}
            or latitude is None
            or longitude is None
            or not next_stop
        ):
            invalid_count += 1
            if service and service in seen_services:
                duplicate_services += 1
            continue
        seen_services.add(service)
        rows.append(
            (
                sampled_at,
                retrieved_at,
                service,
                route,
                direction,
                latitude,
                longitude,
                _as_int(item.get("remainingMinutes")),
                next_stop,
                str(item.get("destinationStop", "")).strip() or None,
                _as_int(item.get("orderStop")),
            )
        )
    with _db() as connection:
        connection.executemany(
            """
            INSERT OR REPLACE INTO tram_observations
            (sampled_at, retrieved_at, service, route, direction, latitude,
             longitude, remaining_minutes, next_stop, destination_stop, order_stop)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO tram_collection_runs
            (sampled_at, retrieved_at, raw_count, valid_count, invalid_count,
             duplicate_services)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                sampled_at,
                retrieved_at,
                len(trams),
                len(rows),
                invalid_count,
                duplicate_services,
            ),
        )
        cutoff = int((datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).timestamp())
        connection.execute("DELETE FROM tram_observations WHERE sampled_at < ?", (cutoff,))
        connection.execute("DELETE FROM tram_collection_runs WHERE sampled_at < ?", (cutoff,))
    return len(rows)


def _time_minutes(value: str) -> int | None:
    try:
        hour_text, minute_text = value.split(":", 1)
        hour, minute = int(hour_text), int(minute_text)
    except (AttributeError, TypeError, ValueError):
        return None
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        return None
    return hour * 60 + minute


def _is_quiet(local_time: datetime, start: str, end: str) -> bool:
    start_minutes = _time_minutes(start)
    end_minutes = _time_minutes(end)
    if start_minutes is None or end_minutes is None or start_minutes == end_minutes:
        return False
    current_minutes = local_time.hour * 60 + local_time.minute
    if start_minutes < end_minutes:
        return start_minutes <= current_minutes < end_minutes
    return current_minutes >= start_minutes or current_minutes < end_minutes


def _subscription_values(payload: object) -> tuple[str, str, str, int, int, int, str, str, str]:
    if not isinstance(payload, dict):
        raise ValueError("invalid_payload")
    subscription = payload.get("subscription")
    preferences = payload.get("preferences")
    if not isinstance(subscription, dict) or not isinstance(preferences, dict):
        raise ValueError("invalid_payload")
    endpoint = str(subscription.get("endpoint", "")).strip()
    keys = subscription.get("keys")
    if not isinstance(keys, dict):
        raise ValueError("invalid_subscription")
    p256dh = str(keys.get("p256dh", "")).strip()
    auth = str(keys.get("auth", "")).strip()
    try:
        parsed_endpoint = urllib.parse.urlparse(endpoint)
    except ValueError as error:
        raise ValueError("invalid_subscription") from error
    if (
        parsed_endpoint.scheme != "https"
        or not parsed_endpoint.netloc
        or not 16 <= len(endpoint) <= 4096
        or not 16 <= len(p256dh) <= 512
        or not 8 <= len(auth) <= 256
    ):
        raise ValueError("invalid_subscription")

    line = str(preferences.get("line", ""))
    route = {"L1": 1, "L2": 2}.get(line)
    direction = {"ida": 2, "vuelta": 1}.get(str(preferences.get("direction", "")))
    threshold = {"high": 60, "very-high": 80}.get(str(preferences.get("threshold", "")))
    quiet_start = str(preferences.get("quietStart", ""))
    quiet_end = str(preferences.get("quietEnd", ""))
    language = str(preferences.get("language", "es"))
    if (
        route is None
        or direction is None
        or threshold is None
        or _time_minutes(quiet_start) is None
        or _time_minutes(quiet_end) is None
        or language not in {"es", "en"}
    ):
        raise ValueError("invalid_preferences")
    return endpoint, p256dh, auth, route, direction, threshold, quiet_start, quiet_end, language


def _save_subscription(payload: object) -> None:
    values = _subscription_values(payload)
    now_timestamp = int(time.time())
    with _db() as connection:
        connection.execute(
            """
            INSERT INTO push_subscriptions
            (endpoint, p256dh, auth, route, direction, threshold, quiet_start,
             quiet_end, language, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                route = excluded.route,
                direction = excluded.direction,
                threshold = excluded.threshold,
                quiet_start = excluded.quiet_start,
                quiet_end = excluded.quiet_end,
                language = excluded.language,
                updated_at = excluded.updated_at
            """,
            (*values, now_timestamp),
        )


def _delete_subscription(payload: object) -> None:
    if not isinstance(payload, dict):
        raise ValueError("invalid_payload")
    endpoint = str(payload.get("endpoint", "")).strip()
    if not endpoint or len(endpoint) > 4096:
        raise ValueError("invalid_subscription")
    with _db() as connection:
        connection.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))


def _notification_copy(language: str, service: str, destination: str, load: int) -> dict[str, str]:
    if language == "en":
        return {
            "title": "Busy tram alert",
            "body": f"Service {service} towards {destination}: {load}% occupancy.",
        }
    return {
        "title": "Tranvía con alta ocupación",
        "body": f"Servicio {service} hacia {destination}: {load}% de ocupación.",
    }


def _deliver_push(row: sqlite3.Row, message: dict[str, str]) -> str:
    try:
        assert webpush is not None
        webpush(
            subscription_info={
                "endpoint": row["endpoint"],
                "keys": {"p256dh": row["p256dh"], "auth": row["auth"]},
            },
            data=json.dumps(message, ensure_ascii=False, separators=(",", ":")),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=300,
            timeout=8,
        )
        return "delivered"
    except WebPushException as error:
        response = getattr(error, "response", None)
        status = getattr(response, "status_code", None)
        return "expired" if status in {404, 410} else "failed"
    except Exception:
        return "failed"


def _send_push(row: sqlite3.Row, service: str, load: int) -> tuple[str, str]:
    destinations = {
        (1, 2): "Intercambiador",
        (1, 1): "La Trinidad",
        (2, 2): "Tíncer",
        (2, 1): "La Cuesta",
    }
    destination = destinations[(row["route"], row["direction"])]
    message = _notification_copy(row["language"], service, destination, load)
    message.update(
        {
            "url": "/",
            "tag": f"alerta-tram-occupancy-L{row['route']}-{row['direction']}",
            "icon": "/favicon.png",
        }
    )
    return row["endpoint"], _deliver_push(row, message)


def _test_push(payload: object) -> None:
    if not isinstance(payload, dict):
        raise ValueError("invalid_payload")
    endpoint = str(payload.get("endpoint", "")).strip()
    if not endpoint or len(endpoint) > 4096:
        raise ValueError("invalid_subscription")
    now_timestamp = int(time.time())
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
        ).fetchone()
    if row is None:
        raise LookupError("subscription_not_found")
    if now_timestamp - row["last_tested_at"] < PUSH_TEST_COOLDOWN_SECONDS:
        raise PushTestCooldown("test_cooldown")
    if row["language"] == "en":
        message = {
            "title": "Background alerts are ready",
            "body": "Test received. We can now alert you when your selected tram reaches the occupancy threshold.",
        }
    else:
        message = {
            "title": "Alertas en segundo plano listas",
            "body": "Prueba recibida. Ya podemos avisarte cuando tu tranvía alcance el nivel de ocupación elegido.",
        }
    message.update({"url": "/", "tag": "alerta-tram-push-test", "icon": "/favicon.png"})
    delivery_status = _deliver_push(row, message)
    with _db() as connection:
        if delivery_status == "delivered":
            connection.execute(
                "UPDATE push_subscriptions SET last_tested_at = ? WHERE endpoint = ?",
                (now_timestamp, endpoint),
            )
            return
        if delivery_status == "expired":
            connection.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
            raise LookupError("subscription_expired")
    raise RuntimeError("push_delivery_failed")


def _notify_subscribers(trams: list[dict], occupancy: list[dict]) -> int:
    if not PUSH_ENABLED:
        return 0
    tram_by_service = {
        str(item.get("service", "")).strip(): item
        for item in trams
        if str(item.get("service", "")).strip()
    }
    load_by_service = {item["service"]: item["load"] for item in occupancy}
    now_timestamp = int(time.time())
    local_time = datetime.now(timezone.utc).astimezone(CANARY)
    with _db() as connection:
        subscriptions = connection.execute(
            "SELECT * FROM push_subscriptions ORDER BY updated_at DESC"
        ).fetchall()

    delivered: list[tuple[str, str]] = []
    expired: list[str] = []
    for row in subscriptions:
        if now_timestamp - row["last_notified_at"] < PUSH_COOLDOWN_SECONDS:
            continue
        if _is_quiet(local_time, row["quiet_start"], row["quiet_end"]):
            continue
        candidates = [
            (service, load)
            for service, load in load_by_service.items()
            if load >= row["threshold"]
            and service in tram_by_service
            and _as_int(tram_by_service[service].get("route")) == row["route"]
            and _as_int(tram_by_service[service].get("direction")) == row["direction"]
        ]
        if not candidates:
            continue
        service, load = max(candidates, key=lambda candidate: candidate[1])
        endpoint, delivery_status = _send_push(row, service, load)
        if delivery_status == "delivered":
            delivered.append((endpoint, service))
        elif delivery_status == "expired":
            expired.append(endpoint)

    with _db() as connection:
        connection.executemany(
            "UPDATE push_subscriptions SET last_notified_at = ?, last_service = ? WHERE endpoint = ?",
            [(now_timestamp, service, endpoint) for endpoint, service in delivered],
        )
        connection.executemany(
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
            [(endpoint,) for endpoint in expired],
        )
        stale_before = now_timestamp - PUSH_RETENTION_DAYS * 86400
        connection.execute("DELETE FROM push_subscriptions WHERE updated_at < ?", (stale_before,))
    return len(delivered)


def _collect_once() -> int:
    raw_trams, tram_cache, tram_fetched_at = _fetch_cached("trams", TRAMS_URL)
    if tram_cache == "STALE":
        raise RuntimeError("stale_collection")
    trams = json.loads(raw_trams)
    sampled_at = int(time.time() // 60 * 60)
    # Schedule observations do not depend on the occupancy feed. If occupancy
    # temporarily fails, the already-fetched vehicle evidence remains useful.
    _store_tram_observations(trams, sampled_at, tram_fetched_at)
    valid_trams = [item for item in trams if isinstance(item, dict)]

    raw_occupancy, occupancy_cache, _ = _fetch_cached("occupancy", OCCUPANCY_URL)
    if occupancy_cache == "STALE":
        raise RuntimeError("stale_collection")
    # Never turn an old reading into a new historical sample or push alert.
    occupancy = [item for item in _normalize_occupancy(json.loads(raw_occupancy))
                 if _recent_occupancy(item, time.time())]
    tram_by_service = {
        str(item.get("service", "")).strip(): item
        for item in valid_trams
        if str(item.get("service", "")).strip()
    }
    rows = []
    for item in occupancy:
        tram = tram_by_service.get(item["service"], {})
        rows.append(
            (
                sampled_at,
                item["sourceAt"],
                item["service"],
                item["vehicle"],
                item["load"],
                _as_int(tram.get("route")),
                _as_int(tram.get("direction")),
                str(tram.get("nextStop", "")).strip() or None,
                _as_int(tram.get("orderStop")),
            )
        )
    with _db() as connection:
        connection.executemany(
            """
            INSERT OR REPLACE INTO occupancy_samples
            (sampled_at, source_at, service, vehicle, load, route, direction,
             next_stop, order_stop)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        cutoff = int((datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).timestamp())
        connection.execute("DELETE FROM occupancy_samples WHERE sampled_at < ?", (cutoff,))
    _notify_subscribers(valid_trams, occupancy)
    return len(rows)


def _collector() -> None:
    while True:
        started = time.monotonic()
        _collector_state["lastAttemptAt"] = time.time()
        try:
            _collect_once()
            _collector_state.update(lastSuccessAt=time.time(), error=None)
        except Exception as error:
            _collector_state["error"] = type(error).__name__
            print(f"collector_error={type(error).__name__}", flush=True)
        time.sleep(max(5, COLLECT_SECONDS - (time.monotonic() - started)))


def _percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, round((len(ordered) - 1) * fraction))
    return ordered[index]


def _history(days: int, route: int, direction: int, interval: int) -> bytes:
    since = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    with _db() as connection:
        raw = connection.execute(
            """
            SELECT sampled_at, load FROM occupancy_samples
            WHERE sampled_at >= ? AND route = ? AND direction = ?
            ORDER BY sampled_at
            """,
            (since, route, direction),
        ).fetchall()

    buckets: dict[tuple[int, int], dict[str, object]] = {}
    observed_days: set[str] = set()
    for row in raw:
        local = datetime.fromtimestamp(row["sampled_at"], timezone.utc).astimezone(CANARY)
        minute = (local.hour * 60 + local.minute) // interval * interval
        local_day = local.date().isoformat()
        observed_days.add(local_day)
        bucket = buckets.setdefault((local.weekday(), minute), {"loads": [], "days": set()})
        bucket["loads"].append(row["load"])
        bucket["days"].add(local_day)

    labels = ["L", "M", "X", "J", "V", "S", "D"]
    points = [
        {
            "weekday": weekday,
            "weekdayLabel": labels[weekday],
            "minuteOfDay": minute,
            "timeLabel": f"{minute // 60:02d}:{minute % 60:02d}",
            "route": route,
            "direction": direction,
            "medianLoad": round(statistics.median(bucket["loads"])),
            "p80Load": _percentile(bucket["loads"], 0.8),
            "averageLoad": round(statistics.fmean(bucket["loads"])),
            "samples": len(bucket["loads"]),
            "daysObserved": len(bucket["days"]),
        }
        for (weekday, minute), bucket in sorted(buckets.items())
    ]
    return json.dumps(
        {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "days": days,
            "intervalMinutes": interval,
            "sampleCount": len(raw),
            "observedDays": len(observed_days),
            "firstSampleAt": datetime.fromtimestamp(raw[0]["sampled_at"], timezone.utc).isoformat() if raw else None,
            "lastSampleAt": datetime.fromtimestamp(raw[-1]["sampled_at"], timezone.utc).isoformat() if raw else None,
            "points": points,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "AlertaTramRelay"
    sys_version = ""

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/healthz":
            self._respond(200, b'{"ok":true}', "no-store")
            return
        if parsed.path == "/readyz":
            ready = _operational_status()["ready"]
            self._respond(200 if ready else 503, json.dumps({"ready": ready}).encode(), "no-store")
            return
        if parsed.path not in {"/v1/trams", "/v1/occupancy", "/v1/occupancy/history", "/v1/push/config", "/v1/status"}:
            self._respond(404, b'{"error":"not_found"}', "no-store")
            return
        if not self._authorized():
            self._respond(401, b'{"error":"unauthorized"}', "no-store")
            return

        if parsed.path == "/v1/status":
            self._respond(200, json.dumps(_operational_status()).encode(), "no-store")
            return

        if parsed.path == "/v1/push/config":
            if not PUSH_ENABLED:
                self._respond(503, b'{"error":"push_unavailable"}', "no-store")
                return
            body = json.dumps(
                {"publicKey": VAPID_PUBLIC_KEY}, separators=(",", ":")
            ).encode()
            self._respond(200, body, "private, max-age=3600")
            return

        try:
            if parsed.path == "/v1/trams":
                body, cache_status, fetched_at = _fetch_cached("trams", TRAMS_URL)
                self._respond(200, body, "no-store", {"X-Relay-Cache": cache_status,
                    "X-Relay-Fetched-At": datetime.fromtimestamp(fetched_at, timezone.utc).isoformat()})
            elif parsed.path == "/v1/occupancy":
                body, cache_status, fetched_at = _occupancy_response()
                self._respond(200, body, "no-store", {"X-Relay-Cache": cache_status,
                    "X-Relay-Fetched-At": datetime.fromtimestamp(fetched_at, timezone.utc).isoformat()})
            else:
                query = urllib.parse.parse_qs(parsed.query)
                days = max(1, min(90, _as_int(query.get("days", [30])[0]) or 30))
                route = _as_int(query.get("route", [1])[0]) or 1
                direction = _as_int(query.get("direction", [2])[0]) or 2
                interval = _as_int(query.get("interval", [30])[0]) or 30
                if route not in {1, 2} or direction not in {1, 2} or interval not in {15, 30, 60}:
                    self._respond(400, b'{"error":"invalid_query"}', "no-store")
                    return
                self._respond(200, _history(days, route, direction, interval), "private, max-age=300")
        except Exception:
            self._respond(502, b'{"error":"upstream_unavailable"}', "no-store")

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path not in {"/v1/push/subscriptions", "/v1/push/test"}:
            self._respond(404, b'{"error":"not_found"}', "no-store")
            return
        if not self._authorized():
            self._respond(401, b'{"error":"unauthorized"}', "no-store")
            return
        if not PUSH_ENABLED:
            self._respond(503, b'{"error":"push_unavailable"}', "no-store")
            return
        try:
            payload = self._read_json()
            if path == "/v1/push/subscriptions":
                _save_subscription(payload)
                self._respond(201, b'{"ok":true}', "no-store")
            else:
                _test_push(payload)
                self._respond(200, b'{"ok":true}', "no-store")
        except ValueError as error:
            body = json.dumps({"error": str(error)}, separators=(",", ":")).encode()
            self._respond(400, body, "no-store")
        except LookupError as error:
            body = json.dumps({"error": str(error)}, separators=(",", ":")).encode()
            self._respond(404, body, "no-store")
        except PushTestCooldown:
            self._respond(429, b'{"error":"test_cooldown"}', "no-store", {"Retry-After": "300"})
        except RuntimeError:
            self._respond(502, b'{"error":"push_delivery_failed"}', "no-store")
        except sqlite3.Error:
            self._respond(500, b'{"error":"storage_unavailable"}', "no-store")

    def do_DELETE(self) -> None:  # noqa: N802
        if urllib.parse.urlparse(self.path).path != "/v1/push/subscriptions":
            self._respond(404, b'{"error":"not_found"}', "no-store")
            return
        if not self._authorized():
            self._respond(401, b'{"error":"unauthorized"}', "no-store")
            return
        try:
            _delete_subscription(self._read_json())
            self._respond(200, b'{"ok":true}', "no-store")
        except ValueError as error:
            body = json.dumps({"error": str(error)}, separators=(",", ":")).encode()
            self._respond(400, body, "no-store")
        except sqlite3.Error:
            self._respond(500, b'{"error":"storage_unavailable"}', "no-store")

    def _read_json(self) -> object:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("invalid_length") from error
        if not 1 <= content_length <= 16384:
            raise ValueError("invalid_length")
        try:
            return json.loads(self.rfile.read(content_length))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("invalid_json") from error

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        return bool(TOKEN) and hmac.compare_digest(supplied, f"Bearer {TOKEN}")

    def _respond(
        self,
        status: int,
        body: bytes,
        cache_control: str,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    if not TOKEN:
        raise SystemExit("RELAY_TOKEN is required")
    os.umask(0o077)
    if HISTORY_ENABLED:
        os.makedirs(os.path.dirname(HISTORY_DB), exist_ok=True)
        with _db():
            pass
        os.chmod(HISTORY_DB, 0o600)
        threading.Thread(target=_collector, name="occupancy-collector", daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), RelayHandler).serve_forever()


if __name__ == "__main__":
    main()
