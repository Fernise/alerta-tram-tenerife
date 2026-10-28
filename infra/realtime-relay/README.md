# Realtime relay

The Python relay keeps authorized upstream requests server-side, caches responses and requires a private bearer value on `/v1/*` endpoints. Public `/healthz` and `/readyz` reveal only minimal process/freshness state. Configure your own upstream access, runtime paths and `RELAY_TOKEN` privately.

Optional historical occupancy and schedule analysis use local SQLite state. Preserve original retrieval timestamps: a recent cache response must not turn stale upstream observations into live data.

```sh
python3 -m pip install -r infra/realtime-relay/requirements.txt
python3 -m unittest discover -s infra/realtime-relay -p 'test_*.py'
```

Example systemd/proxy files require adaptation to an independent development deployment. They are not the current configuration of an existing service. Databases, notification subscriptions, backups and private reports must remain outside Git.
