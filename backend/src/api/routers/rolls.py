from db.database import Buggy, Driver, Pusher, RollDate, RollFile, RollHill, RollType, Sensor
from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import Roll, SessionDep
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
        RollHill.pusher_id == pusher.id,
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
    return roll_hill


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
    print(roll_data)
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
    
    roll = Roll(
        driver_notes=roll_data.driver_notes,
        mech_notes=roll_data.mech_notes,
        pusher_notes=roll_data.pusher_notes,
        roll_number=roll_data.roll_number,
        start_time=roll_data.start_time,
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
