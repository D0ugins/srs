import json
import os

import httpx

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
