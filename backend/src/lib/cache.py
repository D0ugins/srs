"""Cache of one roll's smoothed trajectory and its quantities, keyed to the raw trace, the
calibration package, the pipeline sources and the frozen parameters.

Artefact times are trace seconds (video frame 0 = 0); the artefact meta's `event_offset_ms` is the
only sanctioned conversion to `RollEvent`'s roll-local clock (`video_ms = roll_local_ms + offset`)."""
import hashlib
import json
import os
import re
import traceback
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import and_, delete, or_, select, text

from db.database import File, RollEvent, RollFile, RollStat, RollTrace
from lib import estimate as es
from lib.paths import DATA_PATH, resolve_path
from lib.traces import CALIB_PATH, CALIB_VERSION, G, NU, T_SCALE, db_events

N_DRAWS = 100
WINDOW_S = 1.0            # averaging window of the extremum quantities

PARAMS = dict(q_along=es.Q_ALONG, aniso=es.ANISO, nu=NU, t_scale=T_SCALE, vmax=es.VMAX,
              q_free=es.Q_FREE, s_grid=[float(s) for s in es.S_GRID], k_folds=es.K_FOLDS,
              guard_s=es.GUARD_S, guard_edge=es.GUARD_EDGE, window_s=WINDOW_S,
              n_draws=N_DRAWS, calib_version=CALIB_VERSION)

T0_UTC_NOTE = ('UTC of trace t=0, the source File.start_time as stored (naive, no timezone). '
               'Approximate: the DB start times carry a -0.36..-0.63 s systematic measured against '
               'the racebox on 8 rolls, plus a ~130 ms frame-0 lead versus the FIT video_start.')

EVENT_OF = {'hill_1': ('hill_start', '1'), 'hill_2': ('hill_start', '2'),
            'hill_3': ('hill_start', '3'), 'hill_4': ('hill_start', '4'),
            'hill_5': ('hill_start', '5'), 'freeroll_start': ('freeroll_start', None),
            'chute_start': ('chute_start', None), 'finish_line': ('finish_line', None)}


# --- hashing

def _sha(*parts):
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode())
    return h.hexdigest()


def _sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def calib_hashes():
    """Every calibration file's sha256 from the manifest, plus live ones of hills.kml (so refining
    the landmark boundaries invalidates the cache) and roll_videos.json (the trace time base)."""
    files = json.load(open(f'{CALIB_PATH}/manifest.json'))['files']
    return {**{k: v['sha256'] for k, v in files.items()},
            'hills.kml': _sha_file(f'{DATA_PATH}/geo/hills.kml'),
            'roll_videos.json': _sha_file(f'{DATA_PATH}/archive/roll_videos.json')}


def params_hash():
    """sha256 of PARAMS and the calibration hashes: a re-calibration invalidates like a parameter,
    which is what lets `stale_rolls` be exact without reading a single trace."""
    return _sha(json.dumps(PARAMS, sort_keys=True), json.dumps(calib_hashes(), sort_keys=True))


def code_hash():
    d = os.path.dirname(__file__)
    return _sha(*(open(f'{d}/{n}').read() for n in ('traces.py', 'estimate.py', 'cache.py')))


def trace_uri(roll):
    return f'[[traces]]/{roll}.npz'


def fit_uri(roll):
    return f'[[estimates]]/fit/{roll}.npz'


def display_uri(roll):
    return f'[[estimates]]/display/{roll}.npz'


def trace_rolls():
    """Every roll id with a PnP trace on disk."""
    d = resolve_path('[[traces]]/')
    return sorted(int(n[:-4]) for n in os.listdir(d) if n.endswith('.npz'))


def inputs_hash(roll, con=None):
    """sha256 over the trace file's own content, the roll's `roll_start`/`roll_end` and the code and
    parameter hashes.  Only those two events are inputs -- they set the analysis window; the rest are
    outputs this pipeline writes, and feed nothing that is stored."""
    ev = _bounds(con, roll) if con is not None else ''
    return _sha(_sha_file(resolve_path(trace_uri(roll))), ev, code_hash(), params_hash())


def _bounds(con, roll):
    e = db_events(con, roll)
    return json.dumps([e.get('roll_start'), e.get('roll_end')])


# --- computation

def _rows(con, sql, **kw):
    """Query on either a sqlite3 connection or a SQLAlchemy session/connection."""
    if hasattr(con, 'cursor'):
        keys = re.findall(r':(\w+)', sql)
        return con.execute(re.sub(r':\w+', '?', sql), [kw[k] for k in keys])
    return con.execute(text(sql), kw)


def _source_file(con, roll, file_id):
    """The trace's source video file and the roll's calendar date, for the artefact time base."""
    sql = ('select f.uri, f.type, f.start_time, rf.local_start_ms, rf.local_end_ms,'
           ' d.year, d.month, d.day from file f'
           ' join roll r on r.id = :roll join rolldate d on d.id = r.roll_date_id'
           ' left join rollfile rf on rf.file_id = f.id and rf.roll_id = :roll'
           ' where f.id = :file')
    for r in _rows(con, sql, roll=roll, file=file_id):
        return r
    return None


def _meta(con, fit, hashes):
    """The D8 time base carried by both artefacts."""
    roll, m = fit['roll'], fit['meta']
    src = _source_file(con, roll, m['file_id'])
    uri, ftype, start, ls, le = (src[:5] if src else (None,) * 5)
    note = T0_UTC_NOTE
    if start and src and str(start)[:10] != '%04d-%02d-%02d' % tuple(src[5:8]):
        note += ' Start time falls on a different calendar day than the roll date.'
    return dict(roll=roll, t0_utc=str(start) if start else None, t0_utc_note=note,
                event_offset_ms=fit['event_offset_ms'], event_anchor=fit['event_anchor'],
                file_id=m['file_id'], file_uri=uri, file_type=ftype,
                file_start_time=str(start) if start else None,
                local_start_ms=ls, local_end_ms=le, fps=m['video']['fps'],
                start_ms=m['start_ms'], end_ms=m['end_ms'], calib_version=CALIB_VERSION,
                bad_loc=bool(fit['bad_loc']), **hashes)


def _write_artefacts(fit, meta):
    """`display` at the frame times and `fit`, the source that regenerates the draws."""
    t, mean, draws = fit['t'], fit['mean'], fit['draws']
    spd = np.linalg.norm(mean[:, 3:6], axis=1)
    dspd = np.linalg.norm(draws[:, :, 3:6], axis=2)
    energy = 0.5 * spd ** 2 + G * mean[:, 2]
    denergy = 0.5 * dspd ** 2 + G * draws[:, :, 2]
    j = json.dumps(meta)
    for uri in (display_uri(fit['roll']), fit_uri(fit['roll'])):
        os.makedirs(os.path.dirname(resolve_path(uri)), exist_ok=True)
    np.savez_compressed(resolve_path(display_uri(fit['roll'])), meta=np.array(j),
                        t=t, x=mean[:, 0], y=mean[:, 1], z=mean[:, 2], speed=spd, energy=energy,
                        sd_x=draws[:, :, 0].std(0, ddof=1), sd_y=draws[:, :, 1].std(0, ddof=1),
                        sd_z=draws[:, :, 2].std(0, ddof=1), sd_speed=dspd.std(0, ddof=1),
                        sd_energy=denergy.std(0, ddof=1))
    np.savez_compressed(resolve_path(fit_uri(fit['roll'])), meta=np.array(j),
                        roll=fit['roll'], mean=fit['mode'], weights=fit['weights'],
                        q_int=fit['q_int'], s_roll=fit['s_roll'], keep=fit['keep'],
                        events=np.array(json.dumps(fit['events'])),
                        gaps=np.asarray(fit['gaps'], float).reshape(-1, 2))


def restore_draws(roll, events, n_draws=N_DRAWS):
    """Regenerate a roll's Gibbs draws from its stored `fit` artefact, skipping the CV.  Knots inside
    a freed link were blanked in the stored mean, so those rolls re-solve for the Gibbs seed."""
    z = np.load(resolve_path(fit_uri(roll)), allow_pickle=False)
    prob = es.Problem(es.load_record(roll, events))
    prob.s = float(z['s_roll'])
    sm = prob.smoother(z['keep'].astype(bool))
    q_int, mean = z['q_int'], z['mean']
    if not np.isfinite(mean).all():
        mean = sm.solve(q_int)['mean']
    return es.gibbs(sm, q_int, mean, n_keep=n_draws, rng=np.random.default_rng(roll))


def _landmarks_of(name):
    q = name.split('.', 1)
    if len(q) < 2 or q[0] not in ('speed', 'time', 'eloss'):
        return []
    return [n for n in q[1].split('-') if n in es.landmarks()]


def _impossible(cross, lm):
    """A reason string if the crossing times need a speed above VMAX between two landmarks, else
    ''.  Degenerate localization makes the arc jump the whole course in under a second; the corpus
    floor for freeroll_start -> hill_5 is 67.7 s against a 39.6 s physical bound."""
    t = sorted(((lm[n], v) for n, v in cross.items() if v is not None))
    for (a0, t0), (a1, t1) in zip(t, t[1:]):
        if t1 - t0 < (a1 - a0) / es.VMAX:
            return (f'crossings imply {(a1 - a0) / max(t1 - t0, 1e-9):.0f} m/s over {a1 - a0:.0f} m; '
                    'localization degenerate')
    return ''


def _derived(fit, q):
    """The stored quantities with a D7 status, and the landmark crossing times.  A landmark the
    trace never reaches is `outside_trace`, a NaN inside reach is `in_gap`."""
    arc = es.project(fit['mean'][:, :2])[0]
    spd = np.linalg.norm(fit['mean'][:, 3:6], axis=1)
    E = 0.5 * spd ** 2 + G * fit['mean'][:, 2]
    rs = fit['events'].get('roll_start', -np.inf)
    win = (fit['t'] >= rs) & np.isfinite(spd) & np.isfinite(E)   # not capped at roll_end, as in quantities()
    lo, hi = (float(np.nanmin(arc[win])), float(np.nanmax(arc[win]))) if win.any() else (np.nan, np.nan)
    lm = es.landmarks()
    cross = {n: es.crossing_time(fit['t'][win], arc[win], L) for n, L in lm.items()}
    bad = _impossible(cross, lm)
    if bad:
        cross = {n: None for n in cross}
    out = []
    for name in es.STORED_QUANTITIES:
        v, sd = float(q.loc[name, 'value']), float(q.loc[name, 'sd'])
        miss = [n for n in _landmarks_of(name) if not (lo <= lm[n] <= hi)]
        if bad:                      # a degenerate trajectory poisons every quantity, not just the
            status, note = 'failed', bad         # landmark ones -- max_energy comes out absurd too
            v = sd = np.nan
        elif miss:
            status = 'outside_trace'
            note = (', '.join(f'{n} at {lm[n]:.1f} m' for n in miss)
                    + f' outside the trace arc range {lo:.1f}-{hi:.1f} m')
        elif not np.isfinite(v):
            status, note = 'in_gap', 'no finite value inside the trace'
        else:
            status, note = 'ok', None
        out.append(dict(quantity=name, value=v if np.isfinite(v) else None,
                        sd=sd if np.isfinite(sd) else None, unit=q.loc[name, 'unit'],
                        status=status, note=note))
    return out, {n: (float(t) if t is not None and np.isfinite(t) else None)
                 for n, t in cross.items()}


def compute_roll(con, roll_id):
    """Run the pipeline for one roll, write both artefacts, and return everything the DB pass needs.
    Writes no DB rows of its own; `con` is only read (sqlite3 connection or SQLAlchemy session)."""
    hashes = dict(code_hash=code_hash(), params_hash=params_hash())
    out = dict(roll=roll_id, **hashes)
    try:
        out['inputs_hash'] = inputs_hash(roll_id, con)
    except OSError as e:
        return dict(out, status='failed', note=f'{type(e).__name__}: {e}', inputs_hash=None)
    hashes = dict(hashes, inputs_hash=out['inputs_hash'])
    try:
        ev = db_events(con, roll_id)
        fit = es.estimate_roll(roll_id, ev, n_draws=N_DRAWS)
        q = es.quantities(fit['t'], fit['mean'], fit['draws'], fit['events'], w=WINDOW_S)
        meta = _meta(con, fit, hashes)
        _write_artefacts(fit, meta)
    except Exception:
        tb = traceback.format_exc().strip().splitlines()
        return dict(out, status='failed', note=' | '.join(tb[-3:])[:900])
    stats, crossings = _derived(fit, q)
    note = '; '.join(s for s in (
        'bad_loc' if fit['bad_loc'] else '', f"anchor={fit['event_anchor']}",
        f"gaps={len(fit['gaps'])}" if fit['gaps'] else '',
        f"rejected={fit['n_rejected']}" if fit['n_rejected'] else '',
        'speed_bound_not_met' if fit['bound_failed'] else '',
        'not_converged' if not fit['converged'] else '') if s)
    return dict(out, status='ok', note=note, n_samples=int(len(fit['t'])),
                event_offset_ms=fit['event_offset_ms'], event_anchor=fit['event_anchor'],
                bad_loc=bool(fit['bad_loc']), src_file_id=fit['meta']['file_id'],
                stats=stats, crossings=crossings)


# --- DB writes

def enable_wal(session):
    session.execute(text('PRAGMA journal_mode=WAL'))


def _get_or_create_file(session, type_, uri, start_time=None):
    f = session.scalar(select(File).where(File.type == type_, File.uri == uri,
                                          File.sensor_id.is_(None)))
    if not f:
        f = File(type=type_, uri=uri, start_time=start_time)
        session.add(f)
        session.flush()
    return f


def _get_or_create_rollfile(session, roll_id, file_id):
    rf = session.scalar(select(RollFile).where(RollFile.roll_id == roll_id,
                                               RollFile.file_id == file_id))
    if not rf:
        rf = RollFile(roll_id=roll_id, file_id=file_id)
        session.add(rf)
        session.flush()
    return rf


def _trace_row(session, roll_id, kind):
    row = session.scalar(select(RollTrace).where(RollTrace.roll_id == roll_id,
                                                 RollTrace.kind == kind))
    if not row:
        row = RollTrace(roll_id=roll_id, kind=kind)
        session.add(row)
    return row


def write_result(session, res):
    """Persist one `compute_roll` result: the File/RollFile rows, both RollTrace rows and the
    RollStat rows.  Events are written separately by `write_events`."""
    roll, now = res['roll'], datetime.now(timezone.utc)
    if res['status'] == 'failed':
        session.execute(delete(RollStat).where(RollStat.roll_id == roll))
        session.execute(delete(RollTrace).where(RollTrace.roll_id == roll, RollTrace.kind == 'fit'))
        row = _trace_row(session, roll, 'display')
        row.file_id, row.status, row.note, row.n_samples = None, 'failed', res['note'], None
        row.inputs_hash, row.code_hash, row.params_hash = (res['inputs_hash'], res['code_hash'],
                                                           res['params_hash'])
        row.computed_at = now
        return row

    _get_or_create_rollfile(session, roll, _get_or_create_file(
        session, 'trace_pnp', trace_uri(roll)).id)
    display = None
    for kind, uri in (('display', display_uri(roll)), ('fit', fit_uri(roll))):
        f = _get_or_create_file(session, f'trace_{kind}', uri)
        _get_or_create_rollfile(session, roll, f.id)
        row = _trace_row(session, roll, kind)
        row.file_id, row.status, row.note = f.id, 'ok', res['note']
        row.n_samples = res['n_samples']
        row.inputs_hash, row.code_hash, row.params_hash = (res['inputs_hash'], res['code_hash'],
                                                           res['params_hash'])
        row.computed_at = now
        display = display or row

    names = [s['quantity'] for s in res['stats']]
    session.execute(delete(RollStat).where(RollStat.roll_id == roll,
                                           RollStat.quantity.notin_(names)))
    have = {r.quantity: r for r in session.scalars(
        select(RollStat).where(RollStat.roll_id == roll))}
    for s in res['stats']:
        row = have.get(s['quantity'])
        if not row:
            row = RollStat(roll_id=roll, quantity=s['quantity'])
            session.add(row)
        row.value, row.sd, row.unit = s['value'], s['sd'], s['unit']
        row.status, row.note = s['status'], s['note']
        row.inputs_hash, row.computed_at = res['inputs_hash'], now
    return display


def write_events(session, res):
    """Replace the roll's computed crossing events (D9).  Only `hill_start` 1-5, `freeroll_start`,
    `chute_start` and `finish_line` are touched; `roll_start`, `roll_end` and notes never are."""
    roll, off = res['roll'], res.get('event_offset_ms')
    if res['status'] == 'failed' or off is None:
        return 0
    if not any(t is not None for t in res['crossings'].values()):
        return 0            # nothing to replace them with: leave the reviewed events alone
    src = _get_or_create_file(session, 'trace_pnp', trace_uri(roll))
    session.execute(delete(RollEvent).where(RollEvent.roll_id == roll, or_(*[
        and_(RollEvent.type == t, RollEvent.tag.is_(None) if g is None else RollEvent.tag == g)
        for t, g in EVENT_OF.values()])))
    n = 0
    for lm, t in res['crossings'].items():
        if t is None:
            continue
        ty, tag = EVENT_OF[lm]
        session.add(RollEvent(roll_id=roll, type=ty, tag=tag, source_id=src.id,
                              timestamp_ms=round(t * 1000) - off, raw_timestamp=None))
        n += 1
    return n


def ensure_fresh(session, roll_id):
    """Return the roll's `display` RollTrace, recomputing synchronously when it is missing or its
    stored `inputs_hash` no longer matches.  The single seam a background worker would replace."""
    rows = {r.kind: r for r in session.scalars(
        select(RollTrace).where(RollTrace.roll_id == roll_id))}
    row = rows.get('display')
    if row is not None and row.inputs_hash is not None:
        want = None
        try:
            want = inputs_hash(roll_id, session)
        except OSError:
            pass
        if row.inputs_hash == want and (row.status == 'failed' or 'fit' in rows):
            return row
    res = compute_roll(session, roll_id)
    enable_wal(session)
    row = write_result(session, res)
    session.commit()
    return row


def stale_rolls(session, roll_ids):
    """Ids with no cached `display` row or whose stored code/params hashes differ from the current
    ones.  A changed trace file is NOT detected here -- only on a single-roll fetch, which is the
    one path that hashes the trace."""
    ch, ph = code_hash(), params_hash()
    ids = list(roll_ids)
    rows = {r.roll_id: r for r in session.scalars(
        select(RollTrace).where(RollTrace.kind == 'display', RollTrace.roll_id.in_(ids)))}
    return [i for i in ids
            if i not in rows or rows[i].code_hash != ch or rows[i].params_hash != ph]


def read_display(roll_id):
    """The stored display artefact as {column: list} plus its meta, ready to serialize."""
    z = np.load(resolve_path(display_uri(roll_id)), allow_pickle=False)
    cols = {k: np.where(np.isfinite(z[k]), z[k], None).tolist() for k in z.files if k != 'meta'}
    return dict(cols, meta=json.loads(str(z['meta'])))
