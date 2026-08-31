"""Sensor-derived graph series (racebox -> fit -> gpx), on the roll-local clock of the chosen data
file.  The `/rolls/{id}/graphs` API no longer serves these -- it is trace-only -- but the CSV
exports and the notebooks still use them."""
import os

import numpy as np
import pandas as pd

from lib import cache
from lib.fit import get_fit_graph_data, load_fit_file
from lib.geo import enu_to_wgs84
from lib.gpx import get_gpx_graph_data, load_gpx
from lib.paths import resolve_path
from lib.racebox import get_racebox_graph_data

VIDEO_TYPES = ('video_preview', 'edited_vid', 'video_preview_c', 'edited_vid_c',
               'follow_car_vid', 'misc_vid')


def video_roll_file(roll):
    """The roll's video `RollFile`, by display priority."""
    for t in VIDEO_TYPES:
        f = next((rf for rf in roll.roll_files if rf.file.type == t), None)
        if f:
            return f
    return None


def trace_gps_data(session, roll_id: int, video_start: int):
    """`gps_data` from the roll's cached display trace, on the graphs time axis, or None when the
    roll has no usable trace.  Never raises: the caller falls back to the sensor."""
    if not os.path.exists(resolve_path(cache.trace_uri(roll_id))):
        return None                      # no pnp trace: nothing to cache, and nothing to record
    try:
        if cache.ensure_fresh(session, roll_id).status != 'ok':
            return None
        z = np.load(resolve_path(cache.display_uri(roll_id)), allow_pickle=False)
        lat, long = enu_to_wgs84(z['x'], z['y'], z['z'])
    except Exception:
        return None
    return pd.DataFrame({
        'timestamp': np.round(video_start + z['t'] * 1000).astype(int),
        'lat': lat, 'long': long, 'elevation': z['z'], 'speed': z['speed'],
        'energy': z['energy'], 'sd_speed': z['sd_speed'], 'sd_elevation': z['sd_z'],
        'sd_energy': z['sd_energy'], 'sd_x': z['sd_x'], 'sd_y': z['sd_y'],
    })


def get_graph_data(roll, include_imu: bool = True, session=None):
    racebox_files = [rf for rf in roll.roll_files if rf.file.type == 'racebox']
    fit_files = [rf for rf in roll.roll_files if rf.file.type == 'fit']
    gpx_files = [rf for rf in roll.roll_files if rf.file.type == 'gpx'] + [rf for rf in roll.roll_files if rf.file.type == 'gpx_c']

    video_file = video_roll_file(roll)

    data_file = None
    gps_source = None
    response: dict = {}
    if racebox_files:
        data_file = racebox_file = racebox_files[0]
        session_id = data_file.file.uri.split('/')[-1]
        response = get_racebox_graph_data(session_id)
        gps_source = 'racebox'
    elif fit_files:
        data_file = fit_file = fit_files[0]
        fit_path = resolve_path(fit_file.file.uri)
        messages = load_fit_file(fit_path)
        local_end_ms = None if fit_file.local_end_ms is None else fit_file.local_end_ms + 2000
        response = get_fit_graph_data(messages, fit_file.local_start_ms, local_end_ms, include_imu=include_imu)
        gps_source = 'fit'
    elif gpx_files:
        data_file = gpx_file = gpx_files[0]
        gpx_data = load_gpx(resolve_path(gpx_file.file.uri))
        response = get_gpx_graph_data(gpx_data, gpx_file.local_start_ms, gpx_file.local_end_ms)
        gps_source = 'gpx'

    if data_file and video_file:
        video_start = video_file.file.start_time
        data_start = data_file.file.start_time
        if video_start and data_start:
            response['video_start'] = int((video_start - data_start).total_seconds() * 1000)
            response['video_start'] -= data_file.local_start_ms or 0
        else:
            response['video_start'] = 0
        if (video_file.local_start_ms is not None) and (video_file.local_end_ms is not None):
            response['video_end'] = response['video_start'] + (video_file.local_end_ms - video_file.local_start_ms)

    # the trace supersedes the sensor's gps; the sensor keeps supplying the imu on the same axis
    trace = trace_gps_data(session, roll.id, response.get('video_start', 0)) if session is not None else None
    if trace is not None:
        response['gps_data'] = trace
        response['gps_source'] = 'trace'
        if 'video_start' not in response:
            response['video_start'] = 0
            if video_file and (video_file.local_start_ms is not None) and (video_file.local_end_ms is not None):
                response['video_end'] = video_file.local_end_ms - video_file.local_start_ms
    elif not data_file:
        return {}
    elif 'gps_data' in response:
        response['gps_source'] = gps_source

    return response
