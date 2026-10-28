#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

# Run interactively on the VPS so sudo can request the owner's password.
sudo -v
test -f /opt/alerta-tram-relay/server.py
PYTHONPYCACHEPREFIX=/tmp/alerta-tram-pycache python3 -m py_compile server.py backup.py schedule_study.py
PYTHONPYCACHEPREFIX=/tmp/alerta-tram-pycache python3 -m unittest discover -s . -p 'test_*.py'

rollback="/opt/alerta-tram-relay/server.py.before-schedule-study-$(date -u +%Y%m%dT%H%M%S)"
cp -p /opt/alerta-tram-relay/server.py "$rollback"

# Preserve the current database (including WAL data) before applying the schema.
install -m 0755 backup.py /opt/alerta-tram-relay/backup.py
python3 /opt/alerta-tram-relay/backup.py
install -m 0755 server.py /opt/alerta-tram-relay/server.py
install -m 0755 schedule_study.py /opt/alerta-tram-relay/schedule_study.py
install -m 0644 schedule_profiles.json /opt/alerta-tram-relay/schedule_profiles.json
sudo install -m 0644 alerta-tram-schedule-study.service /etc/systemd/system/alerta-tram-schedule-study.service
sudo install -m 0644 alerta-tram-schedule-study.timer /etc/systemd/system/alerta-tram-schedule-study.timer
sudo systemctl daemon-reload

if ! sudo systemctl restart alerta-tram-relay; then
    cp -p "$rollback" /opt/alerta-tram-relay/server.py
    sudo systemctl restart alerta-tram-relay
    echo 'Schedule collector update failed; previous relay code restored.' >&2
    exit 1
fi
if ! curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8787/healthz; then
    cp -p "$rollback" /opt/alerta-tram-relay/server.py
    sudo systemctl restart alerta-tram-relay
    echo 'Health check failed; previous relay code restored.' >&2
    exit 1
fi

sudo systemctl enable --now alerta-tram-schedule-study.timer
sudo systemctl start alerta-tram-schedule-study.service
sudo systemctl status alerta-tram-schedule-study.timer --no-pager
sudo -u appuser python3 /opt/alerta-tram-relay/schedule_study.py status \
    --db /var/lib/alerta-tram-relay/occupancy.sqlite3 \
    --state-dir /var/lib/alerta-tram-relay/schedule-study \
    --profiles /opt/alerta-tram-relay/schedule_profiles.json \
    --days 30
echo 'Private schedule study activated. Raw observations stay in SQLite; reports stay under /var/lib/alerta-tram-relay/schedule-study.'
