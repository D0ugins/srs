from garmin_fit_sdk import Decoder, Stream
from lib.signal import unfiorm_sample
import pandas as pd
import numpy as np
from scipy import signal
import orjson
import json
from functools import lru_cache
from typing import List, TypedDict
import os

FIT_EPOCH_S = 631065600
DATA_PATH = os.getenv('DATA_PATH', '/app/data')

type FitMessages = dict[str, list[dict]]

@lru_cache(maxsize=16)
def load_fit_file(file_path: str) -> FitMessages:
    rel_path = file_path
    if file_path.startswith(DATA_PATH):
        rel_path = file_path[len(DATA_PATH)+1:]
    
    try:
        with open(f'{DATA_PATH}/cache/{rel_path.replace("/", "_").replace('.fit', '')}.json', 'r') as f:
            messages = orjson.loads(f.read())
    except Exception as e:
        stream = Stream.from_file(f'{DATA_PATH}/{rel_path}')
        decoder = Decoder(stream)
        messages, errors = decoder.read(convert_datetimes_to_dates=False)
        if errors: raise ValueError(f"Errors encountered while decoding FIT file: {errors}")
        print(f'Caching {rel_path.replace("/", "_").replace('.fit', '')}.json')
        with open(f'{DATA_PATH}/cache/{rel_path.replace("/", "_").replace('.fit', '')}.json', 'w') as f:
            json.dump(messages, f, default=str)
    
    return messages

def get_camera_starts(messages: FitMessages) -> list[int]:
    """
    Returns list of timestamps (in ms) of video_start events. Returns empty list if none found.
    """
    return [m['timestamp'] * 1000 + m['timestamp_ms']
              for m in messages.get('camera_event_mesgs', []) if m.get('camera_event_type', '') == 'video_start']
    
def get_camera_ends(messages: FitMessages) -> list[int]:
    """
    Returns list of timestamps (in ms) of video_stop events. Returns empty list if none found.
    """
    return [m['timestamp'] * 1000 + m['timestamp_ms']
              for m in messages.get('camera_event_mesgs', []) if m.get('camera_event_type', '') == 'video_end']
    
def get_gps_data(messages: FitMessages) -> pd.DataFrame | None:
    """
    Get gps data from fit file messagges.
    Returns None if no gps data present. Else dataframe with these columns
    - timestamp: timestamp in ms
    - utc_timestamp: utc timestamp as datetime, accurate to second
    - position_lat: gps latitude in degrees
    - position_long: gps longitude in degrees
    - enhanced_speed: speed in m/s (inaccurate)
    - heading: heading in degrees
    - enhanced_altitude: altitude in m (inaccurate)
    
    """
    if 'gps_metadata_mesgs' not in messages:
        return None
    
    gps_mesgs = messages['gps_metadata_mesgs']
    gps_data = pd.DataFrame.from_records(gps_mesgs)
    gps_data.position_lat = gps_data.position_lat / 2**31 * 180
    gps_data.position_long = gps_data.position_long / 2**31 * 180        
    gps_data.utc_timestamp = pd.to_datetime((gps_data.utc_timestamp + FIT_EPOCH_S) * 1e9)
    gps_data.timestamp = gps_data.timestamp * 1000 + gps_data.timestamp_ms
    gps_data.drop(columns=['timestamp_ms'])
    gps_data.index = gps_data.timestamp
    gps_data['speed'] = np.linalg.norm(np.array(gps_data.velocity.to_list()), axis=1)
    
    return gps_data

class SensorMessage(TypedDict): 
    """extra_items=list[int]"""
    timestamp: int
    timestamp_ms: int
    sample_time_offset: list[int]
    
    
# TODO: handle multiple calibration messages (for gyro)
def get_sensor_data(calibration: dict, sensor_messages: List[SensorMessage], fields: dict[str, str], decimation: int = 1) \
    -> tuple[pd.DataFrame, pd.DataFrame, float]:
    # note: can be made ~30% faster by using lists instead of dicts for constructing raw
    raw_list = []
    for group in sensor_messages:
        base_timestamp = group['timestamp'] * 1000 + group['timestamp_ms']
        for i, offset in enumerate(group['sample_time_offset']):
            entry = {
                'timestamp': base_timestamp + offset,
            } | {key: group[name][i] for key, name in fields.items()}
            raw_list.append(entry)
    raw = pd.DataFrame.from_records(raw_list)
    raw = raw.set_index('timestamp').sort_index()
    raw.index = raw.index 
    
    data = np.array(calibration['orientation_matrix']).reshape(3, 3) @ ((raw.to_numpy() \
    - calibration['level_shift'] - calibration['offset_cal']) * \
    (calibration['calibration_factor'] / calibration['calibration_divisor'])).T
    data = pd.DataFrame(data.T, columns=list(fields.keys()), index=raw.index)
    fs = 1000 / np.median(np.diff(data.index))
    
    if decimation > 1:
        uniform_data = unfiorm_sample(data)
        decimated_data = signal.decimate(uniform_data.to_numpy().T, decimation).T
        data = pd.DataFrame(decimated_data, columns=list(fields.keys()),
                            index=uniform_data.index[::decimation])
        fs = fs / decimation
    
    data['timestamp'] = data.index
    return raw, data, float(fs)


def get_angular_velocity(gps_data: pd.DataFrame, cutoff: float = 2.0) -> pd.Series:
    """
    Compute angular velocity (in rad/s) from gps heading data.
    Returns pd.Series indexed by timestamp (ms).
    Filters out data where speed < cutoff
    """
    
    heading = gps_data.heading[np.linalg.norm(np.array(gps_data.velocity.to_list()), axis=1) >= cutoff]
    # Account for wrap arounds
    offsets = np.array([heading.shift(1) - heading, heading.shift(1) - heading - 360, heading.shift(1) - heading + 360])
    mins = np.argmin(np.abs(offsets), axis=0)
    heading_diffs = pd.Series(offsets[mins, np.arange(len(mins))], index=heading.index)
    
    return ((heading_diffs * (np.pi / 180)) / (heading_diffs.index.to_series().diff() / 1000)).dropna()
