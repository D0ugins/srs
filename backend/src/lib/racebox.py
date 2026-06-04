import json
import os

import httpx
import pandas as pd
from lib.geo import get_elevations, get_angular_velocity
from datetime import datetime, timedelta, timezone

DATA_PATH = os.getenv('DATA_PATH', '/app/data')
CACHE_DIR = os.path.join(DATA_PATH, 'cache', 'racebox')
RACEBOX_EMAIL = os.getenv('RACEBOX_EMAIL')
RACEBOX_PASS = os.getenv('RACEBOX_PASS')


client = httpx.Client(follow_redirects=False)

def login():
    client.post('https://www.racebox.pro/webapp/login', data={
        'email': RACEBOX_EMAIL,
        'password': RACEBOX_PASS,
        'redirect_to': '',
    })

def load_session(session_id: str) -> dict:
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, f'{session_id}.json')

    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return json.load(f)

    try:        
        resp = client.get(f'https://www.racebox.pro/webapp/session/{session_id}/json')
        resp.raise_for_status()
    except httpx.HTTPStatusError as _:
        login()
        resp = client.get(f'https://www.racebox.pro/webapp/session/{session_id}/json')
        resp.raise_for_status()
        
    data = resp.json()

    with open(cache_path, 'w') as f:
        json.dump(data, f)

    return data


def get_racebox_graph_data(session_id: str) -> dict[str, pd.DataFrame]:
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
    return response


GPS_EPOCH = datetime(1980, 1, 6)
GPS_UTC_OFFSET = 18
SECONDS_PER_WEEK = 604800

def itow_to_utc(itow_ms: int, utc_approx: datetime) -> datetime:
    gps_approx = utc_approx + timedelta(seconds=GPS_UTC_OFFSET)

    gps_seconds_since_epoch = (gps_approx - GPS_EPOCH).total_seconds()
    estimated_week = int(gps_seconds_since_epoch // SECONDS_PER_WEEK)

    best_utc = None
    best_error = None
    # Check neighboring weeks in case estimate is near a boundary
    for week in (estimated_week - 1,
                 estimated_week,
                 estimated_week + 1):
        gps_time = (
            GPS_EPOCH + timedelta(weeks=week) + timedelta(milliseconds=itow_ms)
        )

        utc_time = gps_time - timedelta(seconds=GPS_UTC_OFFSET)

        error = abs((utc_time - utc_approx).total_seconds())
        if best_error is None or error < best_error:
            best_error = error
            best_utc = utc_time

    return best_utc # type: ignore