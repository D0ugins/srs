"""Compute and store every roll's trajectory estimate (D13).

A pool of workers writes the artefacts and one JSON per roll to a spool directory, then a single
process reads the spool and does every SQLite write: the File/RollFile rows, RollTrace, RollStat and
the computed crossing events.  Workers never write to SQLite.  Re-runs skip rolls whose spool result
still matches the current `inputs_hash`.

    uv run python src/notebooks/export_estimates.py --rolls 37,45,750 [--no-events]
    uv run python src/notebooks/export_estimates.py --limit 20
"""
import argparse
import json
import multiprocessing as mp
import os
import sqlite3
import sys
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.database import DB_URI, Roll, engine
from lib import cache
from lib.paths import DATA_PATH

SPOOL = f'{DATA_PATH}/estimates/spool'
DB_FILE = DB_URI.split('sqlite:///')[-1]


def spool_path(roll):
    return f'{SPOOL}/{roll}.json'


def fresh_spool(roll, con):
    """The stored result if it is still valid for the current inputs, else None."""
    try:
        res = json.load(open(spool_path(roll)))
        return res if res.get('inputs_hash') == cache.inputs_hash(roll, con) else None
    except (OSError, ValueError):
        return None


def _work(roll):
    con = sqlite3.connect(f'file:{DB_FILE}?mode=ro', uri=True)
    try:
        res = cache.compute_roll(con, roll)
    finally:
        con.close()
    json.dump(res, open(spool_path(roll), 'w'))
    return roll, res['status'], res.get('note')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rolls', help='comma-separated roll ids (default: every roll with a trace)')
    ap.add_argument('--limit', type=int)
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--force', action='store_true', help='recompute even if the spool is valid')
    ap.add_argument('--no-events', action='store_true', help='skip the RollEvent write-back')
    a = ap.parse_args()

    os.makedirs(SPOOL, exist_ok=True)
    with Session(engine) as ses:
        known = set(ses.scalars(select(Roll.id)))
        rolls = [int(r) for r in a.rolls.split(',')] if a.rolls else cache.trace_rolls()
        rolls = [r for r in rolls if r in known]
        if a.limit:
            rolls = rolls[:a.limit]
        todo = rolls if a.force else [r for r in rolls if fresh_spool(r, ses) is None]
    print(f'{len(rolls)} rolls, {len(todo)} to compute, {a.workers} workers', flush=True)

    t0 = time.time()
    if todo:
        with mp.Pool(a.workers) as pool:
            for i, (roll, status, note) in enumerate(pool.imap_unordered(_work, todo), 1):
                print(f'[{i}/{len(todo)}] {time.time() - t0:6.1f}s roll {roll} {status} {note or ""}',
                      flush=True)

    n_ev, bad = 0, []
    with Session(engine) as ses:
        cache.enable_wal(ses)
        for roll in rolls:
            try:
                res = json.load(open(spool_path(roll)))
            except OSError:
                bad.append(roll)
                continue
            cache.write_result(ses, res)
            if not a.no_events:
                n_ev += cache.write_events(ses, res)
            if res['status'] == 'failed':
                bad.append(roll)
        ses.commit()
    print(f'wrote {len(rolls) - len(bad)} rolls, {n_ev} events, {len(bad)} failed/missing: {bad}')


if __name__ == '__main__':
    sys.exit(main())
