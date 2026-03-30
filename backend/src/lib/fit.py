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


def get_fit_graph_data(messages: dict) -> dict:
    """Extract graph data (gps, centripetal, accelerometer, gyroscope, magnetometer) from fit messages."""
    from lib.geo import get_elevations, get_angular_velocity
    
    response = {}
    gps_data = get_gps_data(messages)
    if gps_data is not None:
        response['gps_data'] = pd.DataFrame({
            'timestamp': gps_data.index,
            'lat': gps_data.position_lat,
            'long': gps_data.position_long,
            'elevation': get_elevations(gps_data, snap_to_course=True, subtract_start_line=True),
            'speed': gps_data.speed,
        }).to_dict(orient='list')
        angular_velocity = get_angular_velocity(gps_data.heading, gps_data.speed, cutoff=1)
        response['centripetal'] = pd.DataFrame({
            'timestamp': angular_velocity.index,
            'values': angular_velocity * gps_data.speed.loc[angular_velocity.index]
        }).to_dict(orient='list')
    
    if 'three_d_sensor_calibration_mesgs' in messages:
        calibration_mesgs = messages['three_d_sensor_calibration_mesgs']
        calibration_data = { m['sensor_type']: m for m in calibration_mesgs }
        if 'accelerometer' in calibration_data and 'accelerometer_data_mesgs' in messages:
            accel_cal = calibration_data['accelerometer']
            _, accel_data, _ = get_sensor_data(accel_cal, 
                                               messages['accelerometer_data_mesgs'],
                                               {'x': 'accel_x', 'y': 'accel_y', 'z': 'accel_z'},
                                               decimation=20)
            accel_data.x *= -1
            accel_data.y *= -1
            response['accelerometer'] = accel_data.to_dict(orient='list')
        if 'gyroscope' in calibration_data and 'gyroscope_data_mesgs' in messages:
            gyro_cal = calibration_data['gyroscope']
            _, gyro_data, _ = get_sensor_data(gyro_cal, 
                                              messages['gyroscope_data_mesgs'],
                                              {'x': 'gyro_x', 'y': 'gyro_y', 'z': 'gyro_z'},
                                              decimation=20)
            response['gyroscope'] = gyro_data.to_dict(orient='list')
        if 'compass' in calibration_data and 'magnetometer_data_mesgs' in messages:
            mag_cal = calibration_data['compass']
            _, mag_data, _ = get_sensor_data(mag_cal, 
                                             messages['magnetometer_data_mesgs'],
                                             {'x': 'mag_x', 'y': 'mag_y', 'z': 'mag_z'},
                                             decimation=20)
            response['magnetometer'] = mag_data.to_dict(orient='list')
    
    return response