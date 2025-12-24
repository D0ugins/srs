from db.database import Driver
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep

router = APIRouter(prefix="/drivers", tags=["drivers"])

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
