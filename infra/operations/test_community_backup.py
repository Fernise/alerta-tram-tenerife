import copy
import importlib.util
import sqlite3
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('verifier', Path(__file__).with_name('verify-community-backup.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def fixture():
    database = sqlite3.connect(':memory:')
    database.row_factory = sqlite3.Row
    verifier.create_schema(database)
    # Real schema, synthetic data only. The SQL-looking note must remain plain text.
    database.execute('''INSERT INTO community_reports
        (id, line, direction, stop, zone, created_at, last_confirmed_at, reporter_hash, kind, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        ('test-report', 'L1', 'ida', 'Weyler', 'Delante', 1, 1, 'test-device', 'incident', "'); DROP TABLE report_flags; --"))
    database.execute('INSERT INTO report_flags VALUES (?, ?, ?, ?)', ('test-report', 'other-device', 'false_or_spam', 2))
    database.execute('INSERT INTO beta_feedback VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     ('test-feedback', 'bug', 'Synthetic feedback', 'desktop', 'en', 'test-digest', 1, None))
    database.execute('INSERT INTO community_restrictions VALUES (?, ?, ?)', ('test-device', 1, 86400001))
    tables = {table: [dict(row) for row in database.execute(f'SELECT * FROM {table}')] for table in verifier.TABLES}
    database.close()
    return {'format': verifier.FORMAT, 'schema': verifier.SCHEMA, 'tables': tables, 'rowCounts': {key: len(value) for key, value in tables.items()}}


class BackupTests(unittest.TestCase):
    def test_isolated_restore(self):
        self.assertEqual(verifier.verify(fixture())['restoreTest'], 'ok')

    def test_legacy_v1_restore_still_works(self):
        data = fixture()
        data['format'] = 'alerta-tram-community-v1'
        data['schema'] = '0005_boring_lily_hollister'
        del data['tables']['beta_feedback']
        del data['rowCounts']['beta_feedback']
        del data['tables']['community_restrictions']
        del data['rowCounts']['community_restrictions']
        self.assertEqual(verifier.verify(data)['restoreTest'], 'ok')

    def test_legacy_v2_restore_still_works(self):
        data = fixture()
        data['format'] = 'alerta-tram-community-v2'
        data['schema'] = '0006_curved_barracuda'
        del data['tables']['community_restrictions']
        del data['rowCounts']['community_restrictions']
        self.assertEqual(verifier.verify(data)['restoreTest'], 'ok')

    def test_missing_or_extra_table_rejected(self):
        data = fixture()
        del data['tables']['report_flags']
        with self.assertRaises(ValueError):
            verifier.verify(data)

    def test_wrong_count_rejected(self):
        data = fixture()
        data['rowCounts']['community_reports'] = 2
        with self.assertRaises(ValueError):
            verifier.verify(data)

    def test_orphan_foreign_key_rejected(self):
        data = fixture()
        data['tables']['report_flags'][0]['report_id'] = 'missing'
        with self.assertRaises(sqlite3.IntegrityError):
            verifier.verify(data)

    def test_duplicate_primary_key_rejected(self):
        data = fixture()
        data['tables']['community_reports'].append(copy.deepcopy(data['tables']['community_reports'][0]))
        data['rowCounts']['community_reports'] = 2
        with self.assertRaises(sqlite3.IntegrityError):
            verifier.verify(data)

    def test_unknown_schema_rejected(self):
        data = fixture()
        data['schema'] = 'future-schema'
        with self.assertRaises(ValueError):
            verifier.verify(data)


if __name__ == '__main__':
    unittest.main()
