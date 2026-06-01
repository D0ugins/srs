import pandas as pd
import gpxpy

def to_dict(point):
  return { 'latitude': point.latitude, 'longitude': point.longitude, 'elevation': point.elevation, 'time': point.time }
def load_gpx(gpx_path):
  with open(gpx_path, 'r') as f:
    gpx = pd.DataFrame([to_dict(p) for p in gpxpy.parse(f).tracks[0].segments[0].points])
    gpx.time = gpx.time.dt.tz_convert(None)
    return gpx