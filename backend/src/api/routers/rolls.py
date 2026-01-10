from db import Roll, SessionDep
from db.database import Buggy, Driver, Pusher, RollDate, RollFile, RollHill, RollType, RollEvent, Sensor
from lib.fit import get_angular_velocity, get_camera_ends, get_camera_starts, get_gps_data, get_sensor_data, load_fit_file
from lib.geo import get_elevations
import numpy as np
import pandas as pd
from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime
from pydantic import BaseModel


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

def get_or_create_rollfile(session: SessionDep, 
                           roll_file_input: RollFileInput, 
                           roll_id: int) -> RollFile:
    query = select(RollFile).where(
        RollFile.type == roll_file_input.type,
        RollFile.uri == roll_file_input.uri,
        RollFile.roll_id == roll_id
    )
    roll_file = session.scalar(query)
    if not roll_file:
        sensor = None
        if roll_file_input.sensor_abbreviation:
            sensor = get_or_create_sensor(session, roll_file_input.sensor_abbreviation)
        
        roll_file = RollFile(
            type=roll_file_input.type,
            uri=roll_file_input.uri,
            sensor=sensor,
            roll_id=roll_id
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

@router.get("")
def get_rolls(
    session: SessionDep,
    roll_date_id: int | None = Query(None),
    buggy_id: int | None = Query(None),
    driver_id: int | None = Query(None),
    # skip: int = Query(0, ge=0),
    # limit: int = Query(100, ge=1, le=1000)
):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_files),
        selectinload(Roll.roll_date)
    )
    
    if roll_date_id:
        query = query.where(Roll.roll_date_id == roll_date_id)
    if buggy_id:
        query = query.where(Roll.buggy_id == buggy_id)
    if driver_id:
        query = query.where(Roll.driver_id == driver_id)
    
    rolls = session.scalars(query).all()
    return rolls

@router.get('/{roll_id}')
def get_roll(roll_id: int, session: SessionDep):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_files).selectinload(RollFile.sensor),
        selectinload(Roll.roll_date),
        selectinload(Roll.roll_events),
        selectinload(Roll.roll_hills).selectinload(RollHill.pusher),
    ).where(Roll.id == roll_id)
    
    roll = session.scalar(query)
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")

    return roll

@router.put("/{roll_id}")
def update_roll(roll_id: int, roll_data: RollUpdate, session: SessionDep):
    # print(roll_data)
    roll = session.get(Roll, roll_id)
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")

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

# TMP: for dev
cached_id = None
cached = None

@router.get("/{roll_id}/graphs")
def get_roll_graphs(roll_id: int, session: SessionDep):
    global cached_id, cached
    if roll_id == cached_id and cached is not None:
        return cached
    
    roll = session.scalar(
        select(Roll).options(selectinload(Roll.roll_files)).where(Roll.id == roll_id)
    )    
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")
    
    fit_files = [rf for rf in roll.roll_files if rf.type == 'fit']
    if not fit_files:
        return {}
    fit_file = fit_files[0].uri.replace('%fit%', 'virbs')
    try:
        messages = load_fit_file(fit_file)
    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail=f"Error loading fit file: {e}")
    
    response = {}
    gps_data = get_gps_data(messages)
    if gps_data is not None:
        speed = pd.Series(np.linalg.norm(np.array(gps_data.velocity.to_list()), axis=1), index=gps_data.index)
        response['gps_data'] = pd.DataFrame({
            'timestamp': gps_data.index,
            'lat': gps_data.position_lat,
            'long': gps_data.position_long,
            'elevation': get_elevations(gps_data, snap_to_course=True, subtract_start_line=True),
            'speed': speed,
        }).to_dict(orient='list')
        angular_velocity = get_angular_velocity(gps_data, 1)
        response['centripetal'] = pd.DataFrame({
            'timestamp': angular_velocity.index,
            'values': angular_velocity * speed.loc[angular_velocity.index]  # v^2 / r = v * omega
        }).to_dict(orient='list')
        
    
    # TODO: handle multiple calibration messages (for gyro)
    if 'three_d_sensor_calibration_mesgs' in messages:
        calibration_mesgs = messages['three_d_sensor_calibration_mesgs']
        calibration_data = { m['sensor_type']: m for m in calibration_mesgs }
        if 'accelerometer' in calibration_data and 'accelerometer_data_mesgs' in messages:
            accel_cal = calibration_data['accelerometer']
            _, accel_data, _ = get_sensor_data(accel_cal, 
                                               messages['accelerometer_data_mesgs'], # type: ignore
                                               {'x': 'accel_x', 'y': 'accel_y', 'z': 'accel_z'},
                                               decimation=20)
            # makes these positive for forward facing virb
            accel_data.x *= -1
            accel_data.y *= -1
            response['accelerometer'] = accel_data.to_dict(orient='list')
        if 'gyroscope' in calibration_data and 'gyroscope_data_mesgs' in messages:
            gyro_cal = calibration_data['gyroscope']
            _, gyro_data, _ = get_sensor_data(gyro_cal, 
                                              messages['gyroscope_data_mesgs'], # type: ignore
                                              {'x': 'gyro_x', 'y': 'gyro_y', 'z': 'gyro_z'},
                                              decimation=20)
            response['gyroscope'] = gyro_data.to_dict(orient='list')
        if 'compass' in calibration_data and 'magnetometer_data_mesgs' in messages:
            mag_cal = calibration_data['compass']
            _, mag_data, _ = get_sensor_data(mag_cal, 
                                             messages['magnetometer_data_mesgs'], # type: ignore
                                             {'x': 'mag_x', 'y': 'mag_y', 'z': 'mag_z'},
                                             decimation=20)
            response['magnetometer'] = mag_data.to_dict(orient='list')
    response['camera_starts'] = get_camera_starts(messages)
    response['camera_ends'] = get_camera_ends(messages)
    cached_id = roll_id
    cached = response
    return response

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
          selectinload(Roll.roll_files),
          selectinload(Roll.roll_events)
    ).where(Roll.id == roll_id)
    
    roll = session.scalar(query)
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")
    
    stats = {}
    roll_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'roll_start']
    hill1_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'hill_start' and e.tag == '1']
    hill2_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'hill_start' and e.tag == '2']
    freeroll_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'freeroll_start']
    hill3_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'hill_start' and e.tag == '3']
    hill4_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'hill_start' and e.tag == '4']
    hill5_starts = [e.timestamp_ms for e in roll.roll_events if e.type == 'hill_start' and e.tag == '5']
    roll_ends = [e.timestamp_ms for e in roll.roll_events if e.type == 'roll_end']
    
    if len(hill1_starts) == 1 and len(hill2_starts) == 1:
        stats['hill1_time_ms'] = hill2_starts[0] - hill1_starts[0]
    if len(hill2_starts) == 1 and len(freeroll_starts) == 1:
        stats['hill2_time_ms'] = freeroll_starts[0] - hill2_starts[0]
    if len(freeroll_starts) == 1 and len(hill3_starts) == 1:
        stats['freeroll_time_ms'] = hill3_starts[0] - freeroll_starts[0]
    if len(hill3_starts) == 1 and len(hill4_starts) == 1:
        stats['hill3_time_ms'] = hill4_starts[0] - hill3_starts[0]
    if len(hill4_starts) == 1 and len(hill5_starts) == 1:
        stats['hill4_time_ms'] = hill5_starts[0] - hill4_starts[0]
    if len(hill5_starts) == 1 and len(roll_ends) == 1:
        stats['hill5_time_ms'] = roll_ends[0] - hill5_starts[0]
    
    if len(roll_starts) == 1 and len(roll_ends) == 1:
        stats['course_time_ms'] = roll_ends[0] - roll_starts[0]
    
    return stats