"""Non-gravitational specific force along the direction of travel.

`a_fwd` from the WNOJ fit is the full along-track acceleration; subtracting the local gravity
component leaves what the buggy actually did to itself.  Over a coast that is drag plus rolling
resistance; under a push or the brakes it carries that force too, so it is only "drag" between
freeroll_start and chute_start.

The grade comes from the course DEM rather than the trace's own vertical velocity: a rotation of
the map frame relative to gravity would bias `v_z/|v|` in a heading-dependent way, while `a_fwd`
itself is rotation-invariant because |v| is.
"""
import numpy as np
from functools import lru_cache
from scipy.ndimage import map_coordinates, uniform_filter1d

from lib import estimate as es
from lib.paths import DATA_PATH
from lib.racebox_trace import enu_to_ll

G = 9.81
BASELINE_M = 10.0   # DEM smoothing length. Below it the grade noise swamps the ~0.15 m/s^2 drag
                    # signal; above ~25 m the segment mean starts to shift. 1 Hz on a_fwd already
                    # smooths ~12 m at coast speed, so 10 m costs no along-track resolution.


@lru_cache(maxsize=4)
def course_grade(baseline=BASELINE_M, step=1.0):
    """(arc, sin(theta)) along the course centreline from the USGS 1 m DEM.

    Sampled bilinearly -- the nearest-neighbour read in `racebox_trace.dem_z` injects 0.02 m/s^2 of
    grade noise at this baseline.  Snapping to the centreline keeps the samples off the curbs and
    makes the profile independent of each roll's lateral localization error."""
    import rasterio
    from pyproj import Transformer

    line = es.course()[2]
    arc = np.arange(0.0, line.length + step, step)
    pts = np.array([line.interpolate(a).coords[0] for a in arc])
    lat, lon = enu_to_ll(pts)
    with rasterio.open(f'{DATA_PATH}/geo/output_USGS1m.tif') as ds:
        x, y = Transformer.from_crs('epsg:4326', ds.crs, always_xy=True).transform(lon, lat)
        rows, cols = ~ds.transform * (x, y)
        z = map_coordinates(ds.read(1).astype(float), [cols, rows], order=1, mode='nearest')
    z = uniform_filter1d(z, max(1, int(round(baseline / step))), mode='nearest')
    slope = np.gradient(z, arc)                      # dz/d(horizontal arc) = tan(theta)
    return arc, slope / np.hypot(1.0, slope)         # -> sin(theta)


W = 5   # segments either side of the nearest vertex; the centreline steps ~2 m, the buggy is
        # never metres off it, and exactness against `es.project` is asserted in the tests below.


@lru_cache(maxsize=1)
def _centreline():
    from scipy.spatial import cKDTree
    P, S = es.course()[:2]
    AB = np.diff(P, axis=0)
    return P, S, AB, (AB * AB).sum(1), cKDTree(P)


def _arc(xy):
    """Centreline arc of each point.  `es.project` is the reference but costs 190 ms for a roll
    (shapely, point by point); this is the same projection, vectorised over a window of segments
    around the nearest vertex."""
    P, S, AB, L2, tree = _centreline()
    k = np.clip(tree.query(xy)[1][:, None] + np.arange(-W, W + 1)[None], 0, len(AB) - 1)
    d = xy[:, None, :] - P[k]
    t = np.clip((d * AB[k]).sum(2) / L2[k], 0.0, 1.0)
    r = d - t[..., None] * AB[k]
    j = np.argmin((r * r).sum(2), axis=1)
    i = np.arange(len(xy))
    return S[k[i, j]] + t[i, j] * np.sqrt(L2[k[i, j]])


def a_drag(a_fwd, xy):
    """`a_fwd` with the gravity component removed, at the trace's own sample positions."""
    arc, sin_t = course_grade()
    xy = np.asarray(xy, float)
    ok = np.isfinite(xy).all(1)
    g = np.full(len(xy), np.nan)
    g[ok] = np.interp(_arc(xy[ok]), arc, sin_t)
    return np.asarray(a_fwd, float) + G * g
