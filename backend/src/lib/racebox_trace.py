"""Racebox observations in the form `lib.estimate` consumes, as a second source for the trace cache.

Time base: `t = (iTOW - iTOW[0]) / 1000` is exactly `RollEvent.timestamp_ms / 1000` on a racebox
roll, so `event_offset_ms` is 0 (rbtrace FINDINGS section 2).  Height does not come from the GNSS
altitude but from the USGS 1 m DEM sampled along the course centreline, which shares the map's
vertical datum to +0.12 m at the start line."""
import json
import os
from functools import lru_cache

import numpy as np

from lib import estimate as es
from lib.paths import DATA_PATH
from lib.traces import T_SCALE

SIG_POS = 0.012        # m, measured white per-sample horizontal error (9-19 mm over 16 rolls)
SIG_Z = 0.05           # m, DEM profile along the centreline
PAD_S = 2.0            # window pad each side of [roll_start, roll_end]
S_CORR = 1.5           # per-frame CV under-estimates the noise level by this much
ACCEL_FC = 1.0         # Hz, declared acceleration bandwidth (tmp/rbaccel/FINDINGS.md)
FS = 25.0
DEM = f'{DATA_PATH}/geo/output_USGS1m.tif'

PARAMS = dict(sig_pos=SIG_POS, sig_z=SIG_Z, pad_s=PAD_S, s_corr=S_CORR, fs=FS)


def session_of(uri):
    """The racebox session id: the last path segment of a `[[racebox]]/...` uri."""
    return uri.rsplit('/', 1)[-1]


def session_path(uri):
    return os.path.join(DATA_PATH, 'cache', 'racebox', f'{session_of(uri)}.json')


def enu_to_ll(xy):
    """Inverse of `es._enu` in the horizontal plane (iterative, mm-accurate over this course)."""
    xy = np.atleast_2d(np.asarray(xy, float))[:, :2]
    lat = np.full(len(xy), es.LAT0)
    lon = np.full(len(xy), es.LON0)
    for _ in range(6):
        cur = es._enu(lat, lon)[:, :2]
        J = np.stack([es._enu(lat + 1e-5, lon)[:, :2] - cur,
                      es._enu(lat, lon + 1e-5)[:, :2] - cur], -1) / 1e-5
        step = np.linalg.solve(J, (xy - cur)[..., None])[:, :, 0]
        lat += step[:, 0]
        lon += step[:, 1]
    return lat, lon


def dem_z(lat, lon):
    """USGS 1 m DEM height minus ALT0 at geodetic points, i.e. in the map's vertical datum."""
    import rasterio
    from pyproj import Transformer
    with rasterio.open(DEM) as ds:
        tr = Transformer.from_crs('epsg:4326', ds.crs, always_xy=True)
        x, y = tr.transform(np.asarray(lon, float), np.asarray(lat, float))
        z = np.array([v[0] for v in ds.sample(np.column_stack([x, y]))], float)
    z[z < -1e30] = np.nan
    return z - es.ALT0


@lru_cache(maxsize=1)
def centreline_dem(step=1.0):
    """(arc grid, z grid): the DEM height profile along the course centreline.  Snapping to the
    centreline drops the crossfall and keeps the samples off the curbs (<= 0.03 m either way)."""
    line = es.course()[2]
    arc = np.arange(0.0, line.length + step, step)
    pts = np.array([line.interpolate(a).coords[0] for a in arc])
    return arc, dem_z(*enu_to_ll(pts))


def load(uri):
    """One cached racebox session as arrays on the roll-local clock."""
    with open(session_path(uri)) as fh:
        s = json.load(fh)['session']['data']
    A = np.array(s['data'], float)
    c = {k: A[:, i] for i, k in enumerate(s['dataColumns'])}
    itow = c['iTOW']
    return dict(session=session_of(uri), n=len(A), itow0=float(itow[0]),
                t=(itow - itow[0]) / 1000.0, enu=es._enu(c['Latitude'], c['Longitude']))


def rb_record(roll, events, uri):
    """One racebox roll's observations, shaped like `lib.traces.load_record`.  Positions are ENU
    about the RTK base; height is the centreline DEM at the sample's arc."""
    if 'roll_start' not in events or 'roll_end' not in events:
        raise ValueError('roll_start/roll_end missing')
    d = load(uri)
    m = ((d['t'] >= events['roll_start'] / 1e3 - PAD_S)
         & (d['t'] <= events['roll_end'] / 1e3 + PAD_S))
    if m.sum() < 3:
        raise ValueError(f'{m.sum()} racebox samples inside the roll window')
    xy = d['enu'][m, :2]
    arc_g, z_g = centreline_dem()
    z = np.column_stack([xy, np.interp(es.project(xy)[0], arc_g, z_g)])
    n = len(z)
    return dict(roll=roll, t=d['t'][m], z=z, U=np.repeat(np.eye(3)[None], n, 0),
                sig=T_SCALE * np.tile([SIG_POS, SIG_POS, SIG_Z], (n, 1)),
                ok=np.isfinite(z).all(1), k_roll=None, bad_loc=False,
                event_offset_ms=0, event_anchor='racebox',
                events={k: v / 1000 for k, v in events.items()},
                meta=dict(session=d['session'], itow0=d['itow0'], n_session_samples=d['n'],
                          fs=FS, start_ms=events['roll_start'] - round(PAD_S * 1000),
                          end_ms=events['roll_end'] + round(PAD_S * 1000)))
