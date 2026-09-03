"""Quantities of interest, as small reusable estimators over one roll's posterior.

Every estimator reads a `Roll` context and returns `(value, sd)`: the value is the plug-in on the
posterior mean, the sd the spread across draws.  Adding a quantity here costs a `restore_draws`
pass (~2 s/roll), not a refit, because `cache.qoi_hash` covers only this file."""
import numpy as np

from lib.estimate import (G, VMAX, correction, landmarks, project, search_regions)
from lib.racebox_trace import centreline_dem

EXTRA_LANDMARKS = {'crosswalk': 233.0, 'stop_sign': 609.0}
HOLD_S = 2.0       # a crossing counts only if the arc stays past the line this long: pre-roll
                   # motion in the pad and arc noise both produce spurious early crossings
WINDOW_S = 1.0     # averaging window for extremum estimators, carrying the P5 correction
TIME_INFLATE = 1.0 # was 1.5 against the un-inflated posterior; re-derive, the draws now carry it
PICKUP_SPAN = 50.0 # m either side of the hill-3 line the contact search is confined to
# Gates on the posterior mean, tolerances from the corpus (tmp/gatecal): good rolls sit within 4.7 m
# of the road at p99 and never rise more than 8.4 J/kg above their crosswalk energy while coasting.
Z_TOL = 5.0        # m off the DEM road surface
RISE_TOL = 20.0    # J/kg of coasting energy gain


def marks():
    """Landmark name -> centreline arc (m), the KML crossings plus the constants above."""
    return {**landmarks(), **EXTRA_LANDMARKS}


def crossing(t, arc, L, hold=HOLD_S):
    """Time of the first upward crossing of L that stays past it for `hold` seconds."""
    if len(t) < 3:
        return np.nan
    k = max(1, int(round(hold / np.median(np.diff(t)))))
    for i in np.flatnonzero((arc[:-1] < L) & (arc[1:] >= L)):
        aft = arc[i + 1:i + 1 + k]
        if len(aft) and (aft >= L).all():
            return float(t[i] + (L - arc[i]) / (arc[i + 1] - arc[i]) * (t[i + 1] - t[i]))
    return np.nan


class Roll:
    """The per-roll series every estimator shares, stacked as (1 + n_draws, N)."""

    def __init__(self, t, mean, draws, ev, w=WINDOW_S):
        X = np.concatenate([np.asarray(mean, float)[None], np.asarray(draws, float)])
        self.t, self.X, self.ev, self.n = np.asarray(t, float), X, ev, len(X)
        self.r = np.arange(self.n)
        self.speed = np.linalg.norm(X[:, :, 3:6], axis=2)
        self.energy = 0.5 * self.speed ** 2 + G * X[:, :, 2]
        arc0, _, tan = project(X[0, :, :2])
        self.arc = arc0 + np.einsum('sni,ni->sn', X[:, :, :2] - X[0, :, :2], tan)
        self.step = np.linalg.norm(np.diff(X[:, :, :2], axis=1), axis=2)   # travelled, not arc
        self.dt = float(np.median(np.diff(self.t)))
        self.k = max(1, int(round(w / self.dt))) | 1
        self.win, self.m_release, self.m_contact = search_regions(t, self.energy[0], ev)
        rs = ev.get('roll_start', -np.inf)
        self.lmwin = (self.win | (self.t >= rs)) & np.isfinite(self.speed).all(0) \
            & np.isfinite(self.energy).all(0)
        self.marks = marks()
        self._t_at = {}

    def t_at(self, name):
        """Crossing times of a landmark, one per draw."""
        if name not in self._t_at:
            m, L = self.lmwin, self.marks[name]
            self._t_at[name] = np.array([crossing(self.t[m], self.arc[j][m], L) for j in self.r])
        return self._t_at[name]

    def at(self, series, tq):
        """Interpolate a per-draw series at a per-draw time."""
        m = self.lmwin
        return np.array([np.interp(tq[j], self.t[m], series[j][m], np.nan, np.nan)
                         if np.isfinite(tq[j]) else np.nan for j in self.r])


def _row(v, inflate=1.0, sd_extra=0.0, offset=0.0):
    v = np.asarray(v, float)
    sd = np.nanstd(v[1:], ddof=1) if np.isfinite(v[1:]).sum() > 1 else np.nan
    return float(v[0] + offset), float(np.hypot(inflate * sd, sd_extra))


# --- the estimator primitives.

def time_between(R, a, b):
    """Seconds from landmark a to landmark b."""
    return _row(R.t_at(b) - R.t_at(a), inflate=TIME_INFLATE)


def value_at(R, series, name):
    """A series' value where the trajectory crosses a landmark."""
    return _row(R.at(getattr(R, series), R.t_at(name)))


def drop_between(R, series, a, b):
    """How much a series falls from landmark a to landmark b (positive == a loss)."""
    s = getattr(R, series)
    return _row(R.at(s, R.t_at(a)) - R.at(s, R.t_at(b)))


def path_between(R, a, b):
    """Distance actually travelled between two landmarks, not the centreline arc."""
    ta, tb = R.t_at(a), R.t_at(b)
    out = np.full(R.n, np.nan)
    for j in R.r:
        if not (np.isfinite(ta[j]) and np.isfinite(tb[j])):
            continue
        m = (R.t[:-1] >= ta[j]) & (R.t[1:] <= tb[j])
        out[j] = R.step[j][m].sum()
    return _row(out)


def extremum(R, series, kind='max', mask=None):
    """The windowed extremum of a series, with the P5 spectral correction."""
    y = _smooth(getattr(R, series), R.k)
    m = _valid(R, mask)
    i = _peak(y, m, kind)
    if i is None:
        return (np.nan, np.nan), None
    var_scale = R.speed[0, i[0]] ** 2 if series == 'energy' else 1.0
    c = correction(R.t, y[0], i[0], _span(R.t, m), R.k, kind, var_scale=var_scale)
    return _row(y[R.r, i], sd_extra=c['sd'], offset=c['offset']), i


def extremum_where(R, series, kind, mask, report):
    """Where a series' extremum happens: `report` is 'arc', 't' or another series."""
    (_, _), i = extremum(R, series, kind, mask)
    if i is None:
        return np.nan, np.nan
    y = R.arc if report == 'arc' else (R.t[i] if report == 't' else
                                       _smooth(getattr(R, report), R.k))
    if report == 't':
        return _row(y)
    v_pk = R.speed[0, i[0]]
    c = correction(R.t, _smooth(getattr(R, series), R.k)[0], i[0], _span(R.t, _valid(R, mask)),
                   R.k, kind, var_scale=v_pk ** 2)
    return _row(y[R.r, i], sd_extra=c['sd_t'] * v_pk if report == 'arc' else 0.0)


def _smooth(y, k):
    from scipy.ndimage import uniform_filter1d
    return uniform_filter1d(y, k, axis=-1, mode='nearest')


def _valid(R, mask=None):
    m = R.win & np.isfinite(R.speed).all(0) & np.isfinite(R.energy).all(0)
    v, h = m.copy(), R.k // 2
    if h:                                    # the average must not reach outside the roll
        v[:h] = False; v[-h:] = False
        v[h:] &= m[:-h]; v[:-h] &= m[h:]
    return v & mask if mask is not None else v


def _peak(y, mask, kind):
    """Per-draw extremum index, or None when nothing is selected (argmin of all-inf is 0)."""
    if not mask.any():
        return None
    yy = np.where(mask[None], y, -np.inf if kind == 'max' else np.inf)
    return np.argmax(yy, 1) if kind == 'max' else np.argmin(yy, 1)


def _span(t, m):
    return float(t[m][-1] - t[m][0]) if m.any() else np.nan


# --- the adopted set.  `deps` names the landmarks a quantity needs, so a trace that never reaches
# one can be reported `outside_trace` rather than silently NaN.

def _t(a, b):
    return dict(fn=lambda R: time_between(R, a, b), unit='s', deps=(a, b))


def _v(series, at, unit):
    return dict(fn=lambda R: value_at(R, series, at), unit=unit, deps=(at,))


def _d(series, a, b, unit):
    return dict(fn=lambda R: drop_between(R, series, a, b), unit=unit, deps=(a, b))


def _p(a, b):
    return dict(fn=lambda R: path_between(R, a, b), unit='m', deps=(a, b))


def _pickup(report):
    """Contact is the energy minimum near the hill-3 line: the buggy coasts down to it and the
    push lifts it back.  Confining the search to the line keeps a spurious dip elsewhere out."""
    def fn(R):
        h3 = marks()['hill_3']
        near = (R.arc[0] >= h3 - PICKUP_SPAN) & (R.arc[0] <= h3 + PICKUP_SPAN)
        v, sd = extremum_where(R, 'energy', 'min', near, report)
        return (v - h3, sd) if report == 'arc' else (v, sd)
    return dict(fn=fn, unit='m' if report == 'arc' else 'm/s', deps=('hill_3',))


QUANTITIES = {
    'time.hill_1-hill_2': _t('hill_1', 'hill_2'),
    'time.hill_2-crosswalk': _t('hill_2', 'crosswalk'),
    'time.hill_3-hill_4': _t('hill_3', 'hill_4'),
    'time.hill_4-hill_5': _t('hill_4', 'hill_5'),
    'time.hill_5-finish_line': _t('hill_5', 'finish_line'),
    'time.crosswalk-hill_3': _t('crosswalk', 'hill_3'),
    'time.crosswalk-stop_sign': _t('crosswalk', 'stop_sign'),
    'time.stop_sign-hill_3': _t('stop_sign', 'hill_3'),
    'time.crosswalk-chute_start': _t('crosswalk', 'chute_start'),
    'time.chute_start-hill_3': _t('chute_start', 'hill_3'),
    'time.hill_1-finish_line': _t('hill_1', 'finish_line'),
    'speed.crosswalk': _v('speed', 'crosswalk', 'm/s'),
    'energy.crosswalk': _v('energy', 'crosswalk', 'J/kg'),
    'speed.chute_start': _v('speed', 'chute_start', 'm/s'),
    'energy.chute_start': _v('energy', 'chute_start', 'J/kg'),
    'eloss.crosswalk-hill_3': _d('energy', 'crosswalk', 'hill_3', 'J/kg'),
    'eloss.crosswalk-chute_start': _d('energy', 'crosswalk', 'chute_start', 'J/kg'),
    'eloss.chute_start-hill_3': _d('energy', 'chute_start', 'hill_3', 'J/kg'),
    'path.crosswalk-hill_3': _p('crosswalk', 'hill_3'),
    'path.crosswalk-chute_start': _p('crosswalk', 'chute_start'),
    'path.chute_start-hill_3': _p('chute_start', 'hill_3'),
    'pickup.arc': _pickup('arc'),
    'pickup.speed': _pickup('speed'),
    'max_speed': dict(fn=lambda R: extremum(R, 'speed', 'max')[0], unit='m/s', deps=()),
    'max_energy': dict(fn=lambda R: extremum(R, 'energy', 'max')[0], unit='J/kg', deps=()),
}


def evaluate(t, mean, draws, ev, names=None):
    """Every adopted quantity for one roll, as {name: (value, sd, unit, deps)}."""
    R = Roll(t, mean, draws, ev)
    out = {}
    for name in (names or QUANTITIES):
        spec = QUANTITIES[name]
        try:
            v, sd = spec['fn'](R)
        except Exception:
            v, sd = np.nan, np.nan
        out[name] = (v, sd, spec['unit'], spec['deps'])
    return out, R


# --- gates.  A degenerate trajectory poisons every quantity, not just the landmark ones, so any
# of these fails the whole roll with the reason recorded.

def implausible(R):
    """A reason string when the posterior mean breaks physics, else ''."""
    lm = R.marks
    t = sorted((lm[n], float(R.t_at(n)[0])) for n in lm if np.isfinite(R.t_at(n)[0]))
    for (a0, t0), (a1, t1) in zip(t, t[1:]):
        if t1 - t0 < (a1 - a0) / VMAX:
            return (f'crossings imply {(a1 - a0) / max(t1 - t0, 1e-9):.0f} m/s over '
                    f'{a1 - a0:.0f} m; localization degenerate')
    ok = R.lmwin & np.isfinite(R.arc[0])
    if ok.any():
        arc_g, z_g = centreline_dem()
        dz = np.abs(R.X[0, ok, 2] - np.interp(R.arc[0][ok], arc_g, z_g))
        if dz.max() > Z_TOL:
            return f'{dz.max():.0f} m off the road surface; localization degenerate'
    t_cw, t_h3 = R.t_at('crosswalk')[0], R.t_at('hill_3')[0]
    if np.isfinite(t_cw) and np.isfinite(t_h3):
        coast = R.lmwin & (R.t >= t_cw) & (R.t <= t_h3)
        e0 = R.at(R.energy, np.full(R.n, t_cw))[0]
        if coast.any() and np.isfinite(e0):
            rise = np.nanmax(R.energy[0][coast]) - e0
            if rise > RISE_TOL:
                return f'coasting energy rises {rise:.0f} J/kg above the crosswalk; localization degenerate'
    return ''


def derive(fit):
    """Every adopted quantity with a status, plus the landmark crossing times.  A landmark the
    trace never reaches is `outside_trace`, a NaN inside reach is `in_gap`."""
    vals, R = evaluate(fit['t'], fit['mean'], fit['draws'], fit['events'])
    m, lm = R.lmwin, R.marks
    arc = R.arc[0]
    lo, hi = (float(np.nanmin(arc[m])), float(np.nanmax(arc[m]))) if m.any() else (np.nan, np.nan)
    cross = {n: (float(R.t_at(n)[0]) if np.isfinite(R.t_at(n)[0]) else None) for n in lm}
    bad = implausible(R)
    if bad:
        cross = {n: None for n in cross}
    out = []
    for name, (v, sd, unit, deps) in vals.items():
        miss = [n for n in deps if not (lo <= lm[n] <= hi)]
        if bad:
            status, note, v, sd = 'failed', bad, np.nan, np.nan
        elif miss:
            status = 'outside_trace'
            note = (', '.join(f'{n} at {lm[n]:.1f} m' for n in miss)
                    + f' outside the trace arc range {lo:.1f}-{hi:.1f} m')
        elif not np.isfinite(v):
            status, note = 'in_gap', 'no finite value inside the trace'
        else:
            status, note = 'ok', None
        out.append(dict(quantity=name, value=v if np.isfinite(v) else None,
                        sd=sd if np.isfinite(sd) else None, unit=unit, status=status, note=note))
    return out, cross
