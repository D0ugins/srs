from fastapi import FastAPI, Query, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import Roll, SessionDep
import os

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/rolls")
def get_rolls(
    session: SessionDep,
    roll_date_id: int | None = Query(None),
    buggy_id: int | None = Query(None),
    driver_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000)
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
    
    rolls = session.scalars(query.offset(skip).limit(limit)).all()
    cleaned_rolls = []
    for roll in rolls:
        roll_dict = jsonable_encoder(roll)
        for redundant_key in ("roll_date_id", "buggy_id", "driver_id"):
            roll_dict.pop(redundant_key, None)
        cleaned_rolls.append(roll_dict)
    return cleaned_rolls

@app.get('/roll/{roll_id}')
def get_roll(roll_id: int, session: SessionDep):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_files),
        selectinload(Roll.roll_date),
        selectinload(Roll.roll_events),
        selectinload(Roll.roll_hills),
    ).where(Roll.id == roll_id)
    
    roll = session.scalar(query)
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")
    roll_dict = jsonable_encoder(roll)
    for redundant_key in ("roll_date_id", "buggy_id", "driver_id"):
        roll_dict.pop(redundant_key, None)
    return roll

app.mount("/%thumbnails%", 
          StaticFiles(directory='/app/data/virbs'), 
          name="thumbnails")
app.mount("/%fit%", 
          StaticFiles(directory=os.path.join(os.path.dirname(__file__), "/app/data/virbs")), 
          name="fit")
app.mount("/%videos%", 
          StaticFiles(directory=os.path.join(os.path.dirname(__file__), "/app/data/videos")), 
          name="videos")