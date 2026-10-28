#!/usr/bin/env python3
"""Private, consistent SQLite snapshot; restore-test before retaining it."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def verified_backup(source: Path, destination: Path) -> Path:
    source = source.resolve(strict=True)
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = destination.resolve(strict=True)
    os.chmod(destination, 0o700)
    started = time.monotonic()

    def progress(_status: int, _remaining: int, _total: int) -> None:
        if time.monotonic() - started > 120:
            raise TimeoutError("backup exceeded two minutes")

    descriptor, temporary = tempfile.mkstemp(prefix=".snapshot-", suffix=".sqlite3", dir=destination)
    os.close(descriptor)
    staging = Path(temporary)
    try:
        # The online backup API includes committed WAL data without stopping the relay.
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as live:
            with closing(sqlite3.connect(staging)) as snapshot:
                live.backup(snapshot, pages=256, progress=progress)
                if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('backup integrity check failed')
                # Restore into an isolated database. Never replace the live database.
                with closing(sqlite3.connect(':memory:')) as restored:
                    snapshot.backup(restored, pages=256, progress=progress)
                    if restored.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                        raise RuntimeError('restore integrity check failed')
                    for table in (
                        'occupancy_samples', 'push_subscriptions',
                        'tram_observations', 'tram_collection_runs',
                    ):
                        exists = snapshot.execute('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?', ('table', table)).fetchone()
                        if exists:
                            expected = snapshot.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                            actual = restored.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                            if expected != actual:
                                raise RuntimeError('restore row count mismatch')
        now = time.time()
        name = 'occupancy-' + datetime.fromtimestamp(now, timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.sqlite3'
        target = destination / name
        os.replace(staging, target)
        os.chmod(target, 0o600)
        with target.open('rb') as handle:
            os.fsync(handle.fileno())
        metadata = {'verifiedAt': now, 'file': name, 'bytes': target.stat().st_size, 'restoreTest': 'ok', 'retentionDays': 7}
        fd, meta_path = tempfile.mkstemp(prefix='.backup-meta-', dir=destination)
        try:
            with os.fdopen(fd, 'w') as handle:
                json.dump(metadata, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(meta_path, destination / 'last-backup.json')
        finally:
            if os.path.exists(meta_path):
                os.unlink(meta_path)
        # Prune only snapshots created by this script after a verified replacement.
        for candidate in destination.iterdir():
            if (re.fullmatch(r'occupancy-\d{8}T\d{12}Z\.sqlite3', candidate.name)
                    and not candidate.is_symlink() and candidate.is_file()
                    and candidate != target and candidate.stat().st_mtime < now - 7 * 86400):
                candidate.unlink()
        return target
    finally:
        staging.unlink(missing_ok=True)


if __name__ == '__main__':
    os.umask(0o077)
    database = Path(os.environ.get('HISTORY_DB', '/var/lib/alerta-tram-relay/occupancy.sqlite3'))
    result = verified_backup(database, database.parent / 'backups')
    print(json.dumps({'backup': 'ok', 'restoreTest': 'ok', 'file': result.name}))
