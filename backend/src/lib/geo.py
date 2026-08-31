from functools import lru_cache

import numpy as np
import pandas as pd
import rasterio
import geopandas as gpd
from shapely.ops import nearest_points
import os

DATA_PATH = os.getenv('DATA_PATH', '/app/data')

@lru_cache(maxsize=1)
def load_elevation_data() -> rasterio.DatasetReader:
    return rasterio.open(f'{DATA_PATH}/geo/output_USGS1m.tif')

@lru_cache(maxsize=1)
def load_course() -> gpd.GeoSeries:
    return gpd.read_file(f'{DATA_PATH}/geo/course.kml').geometry

# TODO: snap to bounding box instead of line
def get_elevations(gps_data: pd.DataFrame, snap_to_course: bool, subtract_start_line: bool) -> pd.Series:
    positions = gpd.GeoSeries(gpd.points_from_xy(gps_data.position_long, gps_data.position_lat), crs='epsg:4326')
    if snap_to_course:
        course = load_course()
        positions = gpd.GeoSeries(nearest_points(course[0], positions.values)[0], crs="epsg:4326") # type: ignore
    
    elevation = load_elevation_data()
    samples = elevation.sample(positions.to_crs(elevation.crs).apply(lambda p: (p.x, p.y)))
    return pd.Series([e[0] for e in samples], index=gps_data.index) - (288.4 if subtract_start_line else 0.0)


def get_angular_velocity(heading: pd.Series, speed: pd.Series, cutoff: float = 2.0) -> pd.Series:
    """
    Compute angular velocity (in rad/s) from heading and speed data.
    Returns pd.Series indexed by timestamp (ms).
    Filters out data where speed < cutoff.
    """
    heading = heading[speed >= cutoff]
    # Account for wrap arounds
    offsets = np.array([heading.shift(1) - heading, heading.shift(1) - heading - 360, heading.shift(1) - heading + 360])
    mins = np.argmin(np.abs(offsets), axis=0)
    heading_diffs = pd.Series(offsets[mins, np.arange(len(mins))], index=heading.index)
    
    return ((heading_diffs * (np.pi / 180)) / (heading_diffs.index.to_series().diff() / 1000)).dropna()


LAT0, LON0, ALT0 = 40.44163016, -79.94165829, 288.42151354   # RTK base: the map frame's ENU origin
_A, _F = 6378137.0, 1 / 298.257223563
_E2 = _F * (2 - _F)


def _ecef(lat, lon, alt):
    la, lo = np.radians(lat), np.radians(lon)
    n = _A / np.sqrt(1 - _E2 * np.sin(la) ** 2)
    return np.stack([(n + alt) * np.cos(la) * np.cos(lo), (n + alt) * np.cos(la) * np.sin(lo),
                     (n * (1 - _E2) + alt) * np.sin(la)], -1)


def enu_to_wgs84(x, y, z):
    """Map-frame ENU metres about the RTK base -> WGS84 latitude and longitude in degrees.

    The inverse of `lib.estimate._enu`; the geodetic latitude is iterated to convergence."""
    la, lo = np.radians(LAT0), np.radians(LON0)
    R = np.array([[-np.sin(lo), np.cos(lo), 0],
                  [-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)],
                  [np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]])
    p = np.stack([x, y, z], -1) @ R + _ecef(LAT0, LON0, ALT0)
    px, py, pz = p[..., 0], p[..., 1], p[..., 2]
    r = np.hypot(px, py)
    lat = np.arctan2(pz, r * (1 - _E2))
    for _ in range(5):
        s = np.sin(lat)
        lat = np.arctan2(pz + _E2 * _A / np.sqrt(1 - _E2 * s * s) * s, r)
    return np.degrees(lat), np.degrees(np.arctan2(py, px))
