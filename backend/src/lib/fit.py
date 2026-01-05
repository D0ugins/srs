from garmin_fit_sdk import Decoder, Stream
import pandas as pd
import numpy as np
FIT_EPOCH_S = 631065600


def decode_fit_file(file_path: str) -> dict[str, list[dict]]:
    stream = Stream.from_file(file_path)
    decoder = Decoder(stream)
    messages, errors = decoder.read(convert_datetimes_to_dates=False)
    if errors: raise ValueError(f"Errors encountered while decoding FIT file: {errors}")
    return messages

def get_camera_starts(messages: dict[str, list[dict]]) -> list[int]:
    """
    Returns list of timestamps (in ms) of video_start events. Returns empty list if none found.
    """
    return [m['timestamp'] * 1000 + m['timestamp_ms']
              for m in messages.get('camera_event_mesgs', []) if m.get('camera_event_type', '') == 'video_start']
    
def get_gps_data(messages: dict[str, list[dict]]) -> pd.DataFrame | None:
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
    
    return gps_data

# TODO: handle multiple calibration messages (for gyro)
def get_sensor_data(calibration, messages, fields):
    raw_list = []
    for group in messages:
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
    data = data.T
    data = pd.DataFrame(data, columns=['x', 'y', 'z'], index=raw.index)
    fs = 1000 / np.mean(np.diff(data.index))
    return raw, data, fs