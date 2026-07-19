from db.database import Driver
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep

router = APIRouter(prefix="/drivers", tags=["drivers"])

class DriverInput(BaseModel):
    name: str

@router.get("")
def get_drivers(
    session: SessionDep,
    # skip: int = Query(0, ge=0),
    # limit: int = Query(100, ge=1, le=1000)
):
    query = select(Driver)
    drivers = session.scalars(query).all()
    return drivers

@router.get("/{driver_id}")
def get_driver(driver_id: int, session: SessionDep):
    query = select(Driver).options(
        selectinload(Driver.rolls)
    ).where(Driver.id == driver_id)

    driver = session.scalar(query)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    return driver

@router.post("")
def create_driver(driver_data: DriverInput, session: SessionDep):
    name = driver_data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    existing = session.scalar(select(Driver).where(Driver.name == name))
    if existing:
        raise HTTPException(status_code=409, detail="A driver with that name already exists")
    driver = Driver(name=name)
    session.add(driver)
    session.commit()
    session.refresh(driver)
    return driver

@router.put("/{driver_id}")
def update_driver(driver_id: int, driver_data: DriverInput, session: SessionDep):
    driver = session.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    name = driver_data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    existing = session.scalar(select(Driver).where(Driver.name == name, Driver.id != driver_id))
    if existing:
        raise HTTPException(status_code=409, detail="A driver with that name already exists")
    driver.name = name
    session.commit()
    session.refresh(driver)
    return driver

@router.delete("/{driver_id}")
def delete_driver(driver_id: int, session: SessionDep):
    driver = session.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    if driver.rolls:
        raise HTTPException(status_code=409, detail=f"Driver has {len(driver.rolls)} linked roll(s)")
    session.delete(driver)
    session.commit()
    return {"ok": True}
