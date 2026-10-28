# Backup verification

`verify-community-backup.py` rebuilds an exported community snapshot in an isolated SQLite database and checks trusted schema, row counts, integrity and foreign keys. It does not restore to a hosted application.

```sh
python3 infra/operations/verify-community-backup.py /private/path/to/export.json
python3 -m unittest discover -s infra/operations -p 'test_*.py'
```

Keep every real export private and outside Git. Existing production recovery state and operator-specific runbooks are intentionally omitted.
