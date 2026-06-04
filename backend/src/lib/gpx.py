import numpy as np
from lib.geo import get_angular_velocity, get_elevations
import pandas as pd
import gpxpy

def to_dict(point):
  return { 'latitude': point.latitude, 'longitude': point.longitude, 'elevation': point.elevation, 'time': point.time }
def load_gpx(gpx_path):
  with open(gpx_path, 'r') as f:
    gpx = pd.DataFrame([to_dict(p) for p in gpxpy.parse(f).tracks[0].segments[0].points])
    gpx['time'] = gpx.time.dt.tz_convert(None)
    return gpx


def calculate_speed(gps_data: pd.DataFrame) -> pd.Series:
    lat = np.radians(gps_data.position_lat)
    lon = np.radians(gps_data.position_long)
    dlat = lat.diff() # type: ignore
    dlon = lon.diff() # type: ignore
    a = np.sin(dlat / 2)**2 + np.cos(lat).shift() * np.cos(lat) * np.sin(dlon / 2)**2 # type: ignore
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    distance = 6371000 * c # Earth radius in meters
    speed = distance / (gps_data.index.to_series().diff()/1000) # speed in m/s
    return speed.fillna(0)

def calculate_heading(gps_data: pd.DataFrame) -> pd.Series:
    lat = np.radians(gps_data.position_lat)
    lon = np.radians(gps_data.position_long)
    dlat = lat.diff() # type: ignore
    dlon = lon.diff() # type: ignore
    x = np.sin(dlon) * np.cos(lat)
    y = np.cos(lat).shift() * np.sin(lat) - np.sin(lat).shift() * np.cos(lat) * np.cos(dlon) # type: ignore
    heading = (np.degrees(np.arctan2(x, y)) + 360) % 360
    return heading.ffill().fillna(0)
  
def get_gpx_graph_data(gpx_data: pd.DataFrame, local_start_ms: int | None = None, local_end_ms: int | None = None) -> dict[str, pd.DataFrame]:
    gps_data = gpx_data.loc[local_start_ms:local_end_ms]
    gps_data.rename(columns={'latitude': 'position_lat', 'longitude': 'position_long', 'enhanced_speed': 'speed'}, inplace=True)
    gps_data.index = gps_data.index * 1000 - (local_start_ms or 0)
    gps_data['speed'] = calculate_speed(gps_data)
    gps_data['heading'] = calculate_heading(gps_data)
    
    response: dict[str, pd.DataFrame] = {}
    response['gps_data'] = pd.DataFrame({
        'timestamp': gps_data.index,
        'lat': gps_data.position_lat,
        'long': gps_data.position_long,
        'elevation': get_elevations(gps_data, snap_to_course=True, subtract_start_line=True),
        'speed': gps_data.speed,
    })
    
    angular_velocity = get_angular_velocity(gps_data.heading, gps_data.speed, cutoff=1)
    response['centripetal'] = pd.DataFrame({
        'timestamp': angular_velocity.index,
        'values': angular_velocity * gps_data.speed.loc[angular_velocity.index]
    })
    
    return response