#!/usr/bin/env python3
"""Verify a community export in isolated SQLite; never connect to production.

Only repository-owned migrations are executed as SQL. Exported content is
untrusted and is inserted using bound parameters, never executed.
"""
import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = '0007_community_restrictions'
LEGACY_TABLES = ('community_reports', 'report_confirmations', 'report_flags', 'anonymous_metrics')
V2_TABLES = (*LEGACY_TABLES, 'beta_feedback')
TABLES = (*V2_TABLES, 'community_restrictions')
FORMAT = 'alerta-tram-community-v3'
FORMATS = {
    'alerta-tram-community-v1': ('0005_boring_lily_hollister', LEGACY_TABLES),
    'alerta-tram-community-v2': ('0006_curved_barracuda', V2_TABLES),
    FORMAT: (SCHEMA, TABLES),
}


def create_schema(database, schema=SCHEMA):
    journal = json.loads((ROOT / 'drizzle/meta/_journal.json').read_text())
    found = False
    for migration in journal['entries']:
        database.executescript((ROOT / 'drizzle' / (migration['tag'] + '.sql')).read_text())
        if migration['tag'] == schema:
            found = True
            break
    if not found:
        raise ValueError('Unsupported repository schema')


def verify(snapshot):
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get('format'), str) or snapshot['format'] not in FORMATS:
        raise ValueError('Unsupported backup format or schema')
    schema, tables = FORMATS[snapshot['format']]
    if snapshot.get('schema') != schema:
        raise ValueError('Unsupported backup format or schema')
    if set(snapshot.get('tables', {})) != set(tables) or set(snapshot.get('rowCounts', {})) != set(tables):
        raise ValueError('Missing or unexpected tables')
    with closing(sqlite3.connect(':memory:')) as database:
        database.execute('PRAGMA foreign_keys = ON')
        create_schema(database, schema)
        with database:
            for table in tables:
                rows = snapshot['tables'][table]
                if not isinstance(rows, list) or len(rows) > 25_000 or snapshot['rowCounts'][table] != len(rows):
                    raise ValueError('Row count mismatch')
                columns = [column[1] for column in database.execute(f'PRAGMA table_info({table})')]
                statement = f'INSERT INTO {table} ({", ".join(columns)}) VALUES ({", ".join("?" for _ in columns)})'
                for row in rows:
                    if not isinstance(row, dict) or set(row) != set(columns):
                        raise ValueError('Missing or unexpected columns')
                    if any(value is not None and type(value) not in (str, int, float) for value in row.values()):
                        raise ValueError('Unsupported cell value')
                    database.execute(statement, [row[column] for column in columns])
            if database.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Integrity check failed')
            if database.execute('PRAGMA foreign_key_check').fetchone() is not None:
                raise ValueError('Foreign key check failed')
            counts = {table: database.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in tables}
            if counts != snapshot['rowCounts']:
                raise ValueError('Restored row count mismatch')
    return {'restoreTest': 'ok', 'scope': 'isolated SQLite, not production', 'rowCounts': counts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    args = parser.parse_args()
    if args.backup.stat().st_size > 20_000_000:
        raise SystemExit('Backup too large for this verifier')
    try:
        print(json.dumps(verify(json.loads(args.backup.read_text()))))
    except (ValueError, TypeError, sqlite3.Error, KeyError):
        # Do not echo a private cell value or SQL parameter on failure.
        raise SystemExit('Backup invalid: format, schema, counts or constraints failed') from None
