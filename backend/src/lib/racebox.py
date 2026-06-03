import json
import os

import httpx
import pandas as pd
from lib.geo import get_elevations, get_angular_velocity

DATA_PATH = os.getenv('DATA_PATH', '/app/data')
CACHE_DIR = os.path.join(DATA_PATH, 'cache', 'racebox')
COOKIES = {'racebox': os.getenv('RACEBOX_ID', '')}


def load_session(session_id: str) -> dict:
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, f'{session_id}.json')

    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return json.load(f)
    url = f'https://www.racebox.pro/webapp/session/{session_id}/json'
    resp = httpx.get(url, cookies=COOKIES, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    with open(cache_path, 'w') as f:
        json.dump(data, f)

    return data


def get_racebox_graph_data(session_id: str) -> tuple[int, dict[str, pd.DataFrame]]:
    """Extract graph data from a racebox session."""
    
    session_data = load_session(session_id)
    columns = session_data['session']['data']['dataColumns']
    rows = session_data['session']['data']['data']
    df = pd.DataFrame(rows, columns=columns)
    
    # iTOW is GPS time of week in ms, normalize to start at 0
    df['timestamp'] = df['iTOW'] - df['iTOW'].iloc[0]
    df['Speed'] = df['Speed'] / 3.6  # kph to m/s
    df.index = df['timestamp']
    
    response: dict[str, pd.DataFrame] = {}
    
    # GPS data
    gps_df = pd.DataFrame({
        'position_lat': df['Latitude'],
        'position_long': df['Longitude'],
    }, index=df.index)
    
    elevations = get_elevations(gps_df, snap_to_course=True, subtract_start_line=True)
    
    response['gps_data'] = pd.DataFrame({
        'timestamp': df['timestamp'],
        'lat': df['Latitude'],
        'long': df['Longitude'],
        'elevation': elevations,
        'speed': df['Speed'],
    })
    
    # Centripetal: angular_velocity * speed
    angular_velocity = get_angular_velocity(df['Heading'], df['Speed'], cutoff=1.0)
    response['centripetal'] = pd.DataFrame({
        'timestamp': angular_velocity.index,
        'values': angular_velocity * df['Speed'].loc[angular_velocity.index],
    })
    
    response['accelerometer'] = pd.DataFrame({
        'timestamp': df['timestamp'],
        'x': df['GForceX'],
        'y': df['GForceY'],
        'z': df['GForceZ'],
    })
    
    response['gyroscope'] = pd.DataFrame({
        'timestamp': df['timestamp'],
        'x': df['GyroX'],
        'y': df['GyroY'],
        'z': df['GyroZ'],
    })
    start_time = session_data['session']['meta']['dateTimeStartedUTC']
    return start_time, response
