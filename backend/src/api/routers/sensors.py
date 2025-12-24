from db.database import Sensor
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep

router = APIRouter(prefix="/sensors", tags=["sensors"])

@router.get("")
def get_sensors(
    session: SessionDep,
):
    query = select(Sensor)
    sensors = session.scalars(query).all()
    return sensors

@router.get("/{sensor_id}")
def get_sensor(sensor_id: int, session: SessionDep):
    query = select(Sensor).options(
        selectinload(Sensor.roll_files)
    ).where(Sensor.id == sensor_id)
    
    sensor = session.scalar(query)
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")
    
    return sensor
