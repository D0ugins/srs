"""Per-frame localization traces and the observation model the estimator consumes.

Trace time is seconds from video frame 0 (`t = dec_idx / fps`), while `RollEvent.timestamp_ms` is
a roll-local clock; `events_video_ms` is the only sanctioned conversion between the two."""
import json
import os
from functools import lru_cache

import numpy as np
import pandas as pd

from lib.paths import DATA_PATH, resolve_path

CALIB_VERSION = os.getenv('CALIB_VERSION', 'v1')
CALIB_PATH = f'{DATA_PATH}/calib/{CALIB_VERSION}'

COV_NAMES = ['rx', 'ry', 'rz', 'tx', 'ty', 'tz']   # rot (rad^2) then trans (m^2)
AX = ('fwd', 'left', 'up')
G = 9.81
NU = 3.5                              # Student-t dof of the per-frame position error
HF_A, HF_B, SIG_REF = 0.693, 0.689, 0.05   # sigma = k_roll * a * s_ref * (sigma_D6 / s_ref) ** b
T_SCALE = 0.754382                    # q90-calibrated sigma -> Student-t(3.5) scale
SIG_FLOOR = 0.002                     # m, floor on degenerate D6 sigmas
HARD_SPEED, HARD_REGRESS, HARD_NCORR = 25.0, 2.0, 20     # B3 hard bounds


@lru_cache(maxsize=1)
def d6_coef():
    """Coefficients of the D6 free per-frame noise model, one row per body axis."""
    d = json.load(open(f'{CALIB_PATH}/noise_model.json'))['fits_all_rolls']['cmb_cov3_ninl_rep']
    return np.array([d[a]['coef'] for a in AX])


@lru_cache(maxsize=1)
def roll_noise():
    """roll -> {'k', 'source', 'resolved', 'bad_loc'}: the resolved per-roll noise level."""
    return {int(k): v for k, v in json.load(open(f'{CALIB_PATH}/roll_noise.json')).items()}


def quat_rpy(q):
    """cam_from_world xyzw quats -> roll/pitch/yaw degrees of an x-fwd, y-left, z-up body
    frame in map coordinates (+Z is up). Positive is right-side-down, nose-up, and
    counter-clockwise from +X."""
    x, y, z, w = q.T
    fwd = np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], 1)
    left = -np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], 1)
    up = -np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], 1)
    return np.degrees(np.stack([np.arctan2(left[:, 2], up[:, 2]),
                                np.arctan2(-fwd[:, 2], np.hypot(left[:, 2], up[:, 2])),
                                np.arctan2(fwd[:, 1], fwd[:, 0])], 1))


def body_axes(q):
    """world_from_body (n,3,3) with columns fwd/left/up, from cam_from_world xyzw quaternions."""
    x, y, z, w = np.asarray(q, float).T
    R = np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], 1),
        np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], 1),
        np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], 1)], 1)
    return np.stack([R[:, 2], -R[:, 0], -R[:, 1]], 2)


def body_sigma_c(z):
    """Position sigma of `centre` along the body axes, as (n, 3) of fwd/left/up metres.

    The stored cov is cam_from_world, whose translation block is neither the centre's
    uncertainty nor in body axes. Inverting it needs pycolmap -- the rotation-translation
    coupling contributes about half the result -- and only then is it rotated into body."""
    import pycolmap
    cov, q, c = z['cov'].astype(np.float64), z['quat'], z['centre']
    s = np.full((len(q), 3), np.nan)
    for i in np.flatnonzero(z['ok'].astype(bool) & np.isfinite(cov[:, 0, 0])):
        rot = pycolmap.Rotation3d(q[i])
        R = rot.matrix()
        cw = pycolmap.get_covariance_for_inverse(pycolmap.Rigid3d(rot, -R @ c[i]), cov[i])
        R_wb = np.stack([R[2], -R[0], -R[1]], 1)
        s[i] = np.sqrt(np.clip(np.diag(R_wb.T @ cw[3:, 3:] @ R_wb), 0, None))
    return s


def load_trace(path, body_sigma=False):
    """One roll's per-frame record -> (DataFrame, meta). Frame-length arrays become columns,
    scalars land in df.attrs. Rotation arrives as roll/pitch/yaw degrees alongside the raw
    quat_{x,y,z,w}, and the 6x6 cov contributes its diagonal as var_*/sig_* columns; those stay
    raw, so they are radians and metres rather than degrees and their translation block is in
    camera axes. Nothing array-valued goes in df.attrs -- pandas compares attrs elementwise when
    it renders a frame, and an ndarray there makes every repr raise.

    body_sigma=True adds sig_{fwd,left,up}: the centre's position sigma along the same body
    axes roll/pitch/yaw use."""
    z = np.load(path, allow_pickle=False)
    n = int(z['frame_idx'].shape[0])
    cols, attrs = {}, {}
    for k in z.files:
        a = z[k]
        if k == 'meta':
            attrs['meta'] = json.loads(str(a))
        elif k == 'quat':
            cols.update(zip(('quat_x', 'quat_y', 'quat_z', 'quat_w'), a.T))
            cols.update(zip(('roll_deg', 'pitch_deg', 'yaw_deg'), quat_rpy(a).T))
        elif k == 'centre':
            cols.update(zip(('centre_x', 'centre_y', 'centre_z'), a.T))
        elif k == 'cov':
            d = np.einsum('nii->ni', a.astype(np.float64))
            for j, nm in enumerate(COV_NAMES):
                cols[f'var_{nm}'] = d[:, j]
                cols[f'sig_{nm}'] = np.sqrt(np.clip(d[:, j], 0, None))
        elif a.ndim == 1 and a.shape[0] == n:
            cols[k] = a
        else:
            attrs[k] = a.item() if a.ndim == 0 else a.tolist()
    df = pd.DataFrame(cols)
    df.attrs = attrs

    if body_sigma:
        for nm, v in zip(('sig_fwd', 'sig_left', 'sig_up'), body_sigma_c(z).T):
            df[nm] = v
    return df, attrs['meta']


def sigma_d6(cov3, n_inl, rep_p50):
    """Per-frame body-axis position sigma (m) from the D6 free model."""
    X = np.log(np.clip(np.c_[cov3, n_inl, rep_p50], 1e-12, None))
    good = np.isfinite(cov3).all(1) & (n_inl > 0) & (rep_p50 > 0)
    s = np.full((len(X), 3), np.nan)
    for j, c in enumerate(d6_coef()):
        s[good, j] = np.exp(c[0] + X[good] @ c[1:])
    return s


def _rows(con, sql, params):
    """Iterate a query on either a sqlite3 connection or a SQLAlchemy session/connection."""
    if hasattr(con, 'cursor'):
        return con.execute(sql.replace(':roll', '?').replace(':file', '?'), params)
    from sqlalchemy import text
    return con.execute(text(sql), dict(zip(('roll', 'file'), params)))


def db_events(con, roll):
    """The roll's events on the roll-local clock, keyed `roll_start`, `roll_end`,
    `hill_start:1`, `freeroll_start`, ...; the earliest row wins a repeated key."""
    ev = {}
    for t, tag, ms in _rows(con, 'select type, tag, timestamp_ms from rollevent'
                            ' where roll_id = :roll order by id', (roll,)):
        ev.setdefault(t if t in ('roll_start', 'roll_end') or not tag else f'{t}:{tag}', ms)
    return ev


@lru_cache(maxsize=1)
def roll_videos():
    """roll -> the extraction bounds on the video file's own clock.  This is the authority on the
    trace time base: `tmp/backlog/scripts/b1_plan.py` built every extraction window from it, and
    `start_ms == max(roll_start - 2000, intro_floor)` holds on all 1110 rolls."""
    return {int(k): v for k, v in json.load(open(f'{DATA_PATH}/archive/roll_videos.json')).items()}


def events_video_ms(roll, ev):
    """Roll events on the trace's video-ms axis.  `RollEvent.timestamp_ms` runs on a roll-local
    clock while roll_videos.json gives the same roll start in video ms, so their difference is the
    offset.  Reconstructing it from the clamped window instead is wrong on the 340 rolls whose
    window was floored at the VIRB intro card."""
    e = roll_videos().get(roll)
    if e is None or 'roll_start' not in ev:
        return None, 'no_anchor'
    return {k: e['roll_start'] + (v - ev['roll_start']) for k, v in ev.items()}, 'roll_videos'


def chord_speed(t_ms, centre, ok):
    """Speed from consecutive ok centres (m/s), nan where either side is not ok."""
    t = np.asarray(t_ms, float)
    v = np.full(len(t), np.nan)
    dt = np.diff(t) / 1e3
    dd = np.linalg.norm(np.diff(centre, axis=0), axis=1)
    good = ok[:-1] & ok[1:] & (dt > 0)
    v[1:][good] = dd[good] / dt[good]
    return v


def hard_flags(t_ms, ok, arc, n_corr, v, in_window):
    """B3 gross-outlier bits: 1 chord speed, 2 arc regression, 4 not ok, 8 n_corr,
    16 speed-adjacent.  `arc` is `arc_pnp` and `v` the chord speed."""
    n = len(t_ms)
    arc = np.where(ok, arc, np.nan)
    hard = np.zeros(n, np.int16)
    vprev = np.r_[np.nan, v[1:]]; vnext = np.r_[v[1:], np.nan]
    hp, hn = np.nan_to_num(vprev) > HARD_SPEED, np.nan_to_num(vnext) > HARD_SPEED
    edge = np.isnan(vprev) | np.isnan(vnext)
    hard[(hp & hn) | (edge & (hp | hn))] |= 1
    hard[(hp ^ hn) & ~edge & ~((hp & hn))] |= 16
    oki = np.flatnonzero(ok & in_window)
    to = t_ms[oki]
    lo, hi = np.searchsorted(to, to - 1000, 'left'), np.searchsorted(to, to, 'left')
    for a, i in enumerate(oki):
        j = oki[lo[a]:hi[a]]
        if len(j) >= 3 and arc[i] < np.median(arc[j]) - HARD_REGRESS:
            hard[i] |= 2
    hard[~ok] |= 4
    hard[n_corr < HARD_NCORR] |= 8
    return hard


def load_record(roll, events):
    """One roll's observations: frame times, world centres, body axes, the per-axis Student-t
    observation scale and the event marks in seconds.  `events` is the roll's DB events on the
    roll-local clock (see `db_events`).  B3 hard-flagged frames (gross outliers, up to 40 % of
    some old rolls) are excluded here; the t-loss alone cannot absorb them."""
    df, meta = load_trace(resolve_path(f'[[traces]]/{roll}.npz'), body_sigma=True)
    ev, anchor = events_video_ms(roll, events)
    t_ms = df['t_ms'].to_numpy(float)
    ok_trace = df['ok'].to_numpy(bool)
    centre = df[['centre_x', 'centre_y', 'centre_z']].to_numpy()
    lo, hi = (ev['roll_start'], ev['roll_end']) if ev else \
        (meta['start_ms'] + 2000, meta['end_ms'] - 2000)
    hard = hard_flags(t_ms, ok_trace, df['arc_pnp'].to_numpy(float), df['n_corr'].to_numpy(),
                      chord_speed(t_ms, centre, ok_trace), (t_ms >= lo) & (t_ms <= hi))
    sd6 = sigma_d6(df[['sig_fwd', 'sig_left', 'sig_up']].to_numpy(),
                   df['n_inl'].to_numpy(float), df['rep_p50'].to_numpy(float))
    noise = roll_noise()[roll]
    k = noise['k']
    sig = T_SCALE * np.maximum(k * HF_A * SIG_REF * (sd6 / SIG_REF) ** HF_B, SIG_FLOOR)
    ok = ok_trace & np.isfinite(sig).all(1) & np.isfinite(centre).all(1) & (hard == 0)
    return dict(roll=roll, t=df['dec_idx'].to_numpy(float) / meta['video']['fps'], z=centre,
                U=body_axes(df[['quat_x', 'quat_y', 'quat_z', 'quat_w']].to_numpy()), sig=sig, ok=ok, k_roll=k, meta=meta,
                bad_loc=noise['bad_loc'], event_anchor=anchor if ev else 'none',
                event_offset_ms=None if not ev else ev['roll_start'] - events['roll_start'],
                events={e: v / 1000 for e, v in (ev or {}).items()})
