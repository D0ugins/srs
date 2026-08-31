from db import Roll, SessionDep
from db.database import Buggy, Driver, File, Pusher, RollDate, RollFile, RollHill, RollType, RollEvent, Sensor
from lib.geo import enu_to_wgs84
from lib.graphs import get_graph_data, video_roll_file
from lib.events import calculate_hill_times, calculate_freeroll_stats
from lib.paths import resolve_path
from lib import cache
from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime
import json
import logging
import numpy as np
import os
import pandas as pd
from pydantic import BaseModel
from typing import cast


router = APIRouter(prefix="/rolls", tags=["rolls"])

class RollDateInput(BaseModel):
    year: int
    month: int
    day: int
    temperature: int | None = None
    humidity: int | None = None
    type: RollType
    
class RollFileInput(BaseModel):
    type: str
    uri: str
    sensor_abbreviation: str | None = None
    
class RollHillInput(BaseModel):
    hill_number: int
    pusher_name: str
    
class RollUpdate(BaseModel):
    driver_notes: str
    mech_notes: str
    pusher_notes: str
    
    buggy_abbreviation: str
    driver_name: str
    roll_number: int | None = None
    start_time: datetime | None = None
    
    roll_date: RollDateInput
    roll_files: list[RollFileInput] = []
    roll_hills: list[RollHillInput] = []

class RollEventInput(BaseModel):
    type: str
    tag: str | None = None
    timestamp_ms: int
    raw_timestamp: datetime | None = None


def get_or_create_rolldate(session: SessionDep, roll_date_input: RollDateInput) -> RollDate:
    query = select(RollDate).where(
        RollDate.year == roll_date_input.year,
        RollDate.month == roll_date_input.month,
        RollDate.day == roll_date_input.day,
        RollDate.type == roll_date_input.type
    )
    rolldate = session.scalar(query)
    if not rolldate:
        rolldate = RollDate(
            year=roll_date_input.year,
            month=roll_date_input.month,
            day=roll_date_input.day,
            type=roll_date_input.type,
            temperature=roll_date_input.temperature,
            humidity=roll_date_input.humidity
        )
        session.add(rolldate)
        session.flush()
    return rolldate

def get_or_create_sensor(session: SessionDep, abbreviation: str) -> Sensor:
    query = select(Sensor).where(Sensor.abbreviation == abbreviation)
    sensor = session.scalar(query)
    if not sensor:
        sensor = Sensor(abbreviation=abbreviation)
        session.add(sensor)
        session.flush()
    return sensor

def get_or_create_file(session: SessionDep, roll_file_input: RollFileInput) -> File:
    sensor = None
    if roll_file_input.sensor_abbreviation:
        sensor = get_or_create_sensor(session, roll_file_input.sensor_abbreviation)

    query = select(File).where(
        File.type == roll_file_input.type,
        File.uri == roll_file_input.uri,
        File.sensor_id == (sensor.id if sensor else None)
    )
    file = session.scalar(query)
    if not file:
        file = File(
            type=roll_file_input.type,
            uri=roll_file_input.uri,
            sensor=sensor,
        )
        session.add(file)
        session.flush()
    return file

def get_or_create_rollfile(session: SessionDep, 
                           roll_file_input: RollFileInput, 
                           roll_id: int) -> RollFile:
    file = get_or_create_file(session, roll_file_input)
    query = select(RollFile).where(
        RollFile.roll_id == roll_id,
        RollFile.file_id == file.id
    )
    roll_file = session.scalar(query)
    if not roll_file:
        roll_file = RollFile(
            roll_id=roll_id,
            file=file,
        )
        session.add(roll_file)
        session.flush()
    return roll_file

def get_or_create_pusher(session: SessionDep, name: str):
    query = select(Pusher).where(Pusher.name == name)
    pusher = session.scalar(query)
    if not pusher:
        pusher = Pusher(name=name)
        session.add(pusher)
        session.flush()
    return pusher

def get_or_create_rollhill(session: SessionDep,
                           roll_hill_input: RollHillInput,
                           roll_id: int):
    
    pusher = get_or_create_pusher(session, roll_hill_input.pusher_name)
    query = select(RollHill).where(
        RollHill.hill_number == roll_hill_input.hill_number,
        RollHill.roll_id == roll_id
    )
    roll_hill = session.scalar(query)
    if not roll_hill:
        roll_hill = RollHill(
            hill_number=roll_hill_input.hill_number,
            pusher=pusher,
            roll_id=roll_id
        )
        session.add(roll_hill)
        session.flush()
    else:
        roll_hill.pusher = pusher
    return roll_hill

def get_or_create_event(session: SessionDep, roll_id: int,
                           roll_event_input: RollEventInput):
    roll_event = session.scalar(
        select(RollEvent).where(
            RollEvent.roll_id == roll_id,
            RollEvent.type == roll_event_input.type,
            RollEvent.tag == roll_event_input.tag,
            RollEvent.timestamp_ms == roll_event_input.timestamp_ms
        )
    )
    if not roll_event:
        roll_event = RollEvent(
            roll_id=roll_id,
            type=roll_event_input.type,
            tag=roll_event_input.tag,
            timestamp_ms=roll_event_input.timestamp_ms,
            raw_timestamp=roll_event_input.raw_timestamp
        )
        session.add(roll_event)
        session.flush()
    return roll_event

def serialize_sensor(sensor: Sensor | None):
    if not sensor:
        return None
    return {
        "id": sensor.id,
        "name": sensor.name,
        "abbreviation": sensor.abbreviation,
        "uri": sensor.uri,
        "type": sensor.type,
        "created_at": sensor.created_at,
        "updated_at": sensor.updated_at,
    }

def serialize_roll_file(roll_file: RollFile, detailed: bool):
    payload = {
        "id": roll_file.id,
        "uri": roll_file.file.uri,
        "type": roll_file.file.type,
        "start_utc": roll_file.file.start_time,
        "local_start_ms": roll_file.local_start_ms,
        "local_end_ms": roll_file.local_end_ms,
        "created_at": roll_file.created_at,
        "updated_at": roll_file.updated_at,
    }
    if detailed:
        payload["sensor"] = serialize_sensor(roll_file.file.sensor)
    else:
        payload["sensor_id"] = roll_file.file.sensor_id
    return payload

def serialize_roll(roll: Roll, detailed: bool):
    payload = {
        "id": roll.id,
        "roll_number": roll.roll_number,
        "start_time": roll.start_time,
        "driver": roll.driver,
        "buggy": roll.buggy,
        "roll_date": roll.roll_date,
        "roll_files": [serialize_roll_file(roll_file, detailed) for roll_file in roll.roll_files],
        "driver_notes": roll.driver_notes,
        "mech_notes": roll.mech_notes,
        "pusher_notes": roll.pusher_notes,
        "created_at": roll.created_at,
        "updated_at": roll.updated_at,
    }
    if detailed:
        payload["roll_events"] = roll.roll_events
        payload["roll_hills"] = roll.roll_hills
    return payload


def serialize_graph_response(response: dict):
    return {
        key: {c: [None if v != v else v for v in s.tolist()] for c, s in value.items()}
             if isinstance(value, pd.DataFrame) else value
        for key, value in response.items()
    }

@router.get("")
def get_rolls(
    session: SessionDep,
    roll_date_id: int | None = Query(None),
    buggy_id: int | None = Query(None),
    driver_id: int | None = Query(None),
    type: RollType | None = Query(None),
    # skip: int = Query(0, ge=0),
    # limit: int = Query(100, ge=1, le=1000)
):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_files).selectinload(RollFile.file),
        selectinload(Roll.roll_date)
    )
    
    if roll_date_id:
        query = query.where(Roll.roll_date_id == roll_date_id)
    if buggy_id:
        query = query.where(Roll.buggy_id == buggy_id)
    if driver_id:
        query = query.where(Roll.driver_id == driver_id)
    if type:
        query = query.where(Roll.roll_date.has(RollDate.type == type))
    
    rolls = session.scalars(query).all()
    return [serialize_roll(roll, detailed=False) for roll in rolls]

@router.get('/{roll_id}')
def get_roll(roll_id: int, session: SessionDep):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_files).selectinload(RollFile.file).selectinload(File.sensor),
        selectinload(Roll.roll_date),
        selectinload(Roll.roll_events),
        selectinload(Roll.roll_hills).selectinload(RollHill.pusher),
    ).where(Roll.id == roll_id)
    
    roll = session.scalar(query)
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")

    return serialize_roll(roll, detailed=True)

@router.put("/{roll_id}")
def update_roll(roll_id: int, roll_data: RollUpdate, session: SessionDep):
    # print(roll_data)
    roll = session.get(Roll, roll_id)
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")
    if roll_data.roll_number is None and roll_data.start_time is None:
        raise HTTPException(
            status_code=400,
            detail="Either Roll Number or Start Time must be provided"
        )
        
    roll.driver_notes = roll_data.driver_notes
    roll.mech_notes = roll_data.mech_notes
    roll.pusher_notes = roll_data.pusher_notes
    roll.roll_number = roll_data.roll_number
    roll.start_time = roll_data.start_time
    
    driver = session.execute(
        select(Driver).where(Driver.name == roll_data.driver_name)
    ).scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    roll.driver = driver
    buggy = session.execute(
        select(Buggy).where(Buggy.abbreviation == roll_data.buggy_abbreviation)
    ).scalar_one_or_none()
    if not buggy:
        raise HTTPException(status_code=404, detail="Buggy not found")
    roll.buggy = buggy
    
    rolldate = get_or_create_rolldate(session, roll_data.roll_date)
    roll.roll_date = rolldate
    roll.roll_files = [get_or_create_rollfile(session, rf_input, roll.id) for rf_input in roll_data.roll_files]
    roll.roll_hills = [get_or_create_rollhill(session, rh_input, roll.id) for rh_input in roll_data.roll_hills]
    
    # session.flush()
    # print(get_roll(roll_id, session))
    # session.rollback()
    session.commit()
    session.refresh(roll)
    
    return get_roll(roll_id, session)

@router.post("")
def create_roll(roll_data: RollUpdate, session: SessionDep):
    rolldate = get_or_create_rolldate(session, roll_data.roll_date)
    if roll_data.roll_number is None and roll_data.start_time is None:
        raise HTTPException(
            status_code=400,
            detail="Either Roll Number or Start Time must be provided"
        )
    driver = session.execute(
        select(Driver).where(Driver.name == roll_data.driver_name)
    ).scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    buggy = session.execute(
        select(Buggy).where(Buggy.abbreviation == roll_data.buggy_abbreviation)
    ).scalar_one_or_none()
    if not buggy:
        raise HTTPException(status_code=404, detail="Buggy not found")
    
    roll = Roll(
        driver_notes=roll_data.driver_notes,
        mech_notes=roll_data.mech_notes,
        pusher_notes=roll_data.pusher_notes,
        roll_number=roll_data.roll_number,
        start_time=roll_data.start_time,
        driver=driver,
        buggy=buggy,
        roll_date=rolldate
    )
    
    session.add(roll)
    session.flush()
    
    roll.roll_files = [get_or_create_rollfile(session, rf_input, roll.id) for rf_input in roll_data.roll_files]
    roll.roll_hills = [get_or_create_rollhill(session, rh_input, roll.id) for rh_input in roll_data.roll_hills]
    
    # session.flush()
    # print(get_roll(roll_id, session))
    # session.rollback()
    session.commit()
    session.refresh(roll)
    
    return get_roll(roll.id, session)

TRACE_SOURCES = ('pnp', 'racebox')     # preference order; racebox serves the rolls with no camera


def trace_graph_data(session, roll):
    """The roll's cached display trace as graph data, on the roll-local clock its events use, or
    `{}` when the roll has no usable trace.  Never raises."""
    source = next((k for k in TRACE_SOURCES if roll.id in cache.source_rolls(session, k)), None)
    if source is None:
        return {}
    try:
        if cache.ensure_fresh(session, roll.id, source).status != 'ok':
            return {}
        z = np.load(resolve_path(cache.display_uri(roll.id, source)), allow_pickle=False)
        video_start = -int(json.loads(str(z['meta']))['event_offset_ms'])
        lat, long = enu_to_wgs84(z['x'], z['y'], z['z'])
    except Exception:                    # a schema/artefact fault must not look like "no trace"
        logging.exception('trace graph data failed for roll %s', roll.id)
        return {}
    response = {
        'gps_data': pd.DataFrame({
            'timestamp': np.round(video_start + z['t'] * 1000).astype(int),
            'lat': lat, 'long': long, 'elevation': z['z'], 'speed': z['speed'],
            'energy': z['energy'], 'sd_speed': z['sd_speed'], 'sd_elevation': z['sd_z'],
            'sd_energy': z['sd_energy'], 'sd_x': z['sd_x'], 'sd_y': z['sd_y'],
        }),
        'gps_source': 'trace' if source == 'pnp' else source,
        'video_start': video_start,
    }
    video_file = video_roll_file(roll)
    if video_file and (video_file.local_start_ms is not None) and (video_file.local_end_ms is not None):
        response['video_end'] = video_start + (video_file.local_end_ms - video_file.local_start_ms)
    return response


@router.get("/{roll_id}/graphs")
def get_roll_graphs(roll_id: int, session: SessionDep):
    roll = session.scalar(
        select(Roll).options(selectinload(Roll.roll_files).selectinload(RollFile.file)).where(Roll.id == roll_id)
    )    
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")

    return serialize_graph_response(trace_graph_data(session, roll))

@router.get("/{roll_id}/events")
def get_roll_events(roll_id: int, session: SessionDep):
    roll = session.scalar(
        select(Roll).options(selectinload(Roll.roll_events)).where(Roll.id == roll_id)
    )    
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")
    return roll.roll_events

@router.put("/{roll_id}/events")
def update_roll_events(roll_id: int, events: list[RollEventInput], session: SessionDep):
    roll = session.scalar(
        select(Roll).options(selectinload(Roll.roll_events)).where(Roll.id == roll_id)
    )    
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")
    
    
    roll.roll_events = [get_or_create_event(session, roll_id, event_input) for event_input in events]
    # session.flush()
    # print(roll.roll_events)
    # session.rollback()
    session.commit()
    session.refresh(roll)
    return roll.roll_events

@router.get("/{roll_id}/stats")
def get_roll_stats(roll_id: int, session: SessionDep):
    query = select(Roll).options(
        selectinload(Roll.roll_files).selectinload(RollFile.file),
          selectinload(Roll.roll_events)
    ).where(Roll.id == roll_id)
    
    roll = session.scalar(query)
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")
    
    stats = {}
    roll_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'roll_start']
    roll_ends = [e.timestamp_ms for e in roll.roll_events if e.type == 'roll_end']
    
    hill_times = calculate_hill_times(roll.roll_events)
    for hill_num, time_ms in hill_times.items():
        if time_ms is not None:
            stats[f'hill{hill_num}_time_ms'] = time_ms
    
    if len(roll_starts) == 1 and len(roll_ends) == 1:
        stats['course_time_ms'] = roll_ends[0] - roll_starts[0]
        
    racebox_files = [rf for rf in roll.roll_files if rf.file.type == 'racebox']
    fit_files = [rf for rf in roll.roll_files if rf.file.type == 'fit']
    if racebox_files or fit_files:
        graphs = get_graph_data(roll, include_imu=False, session=session)
        
        freeroll_stats = calculate_freeroll_stats(graphs, roll.roll_events)
        stats.update(freeroll_stats)
    
    return stats
