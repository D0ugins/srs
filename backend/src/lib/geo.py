from functools import lru_cache

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
