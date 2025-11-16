from fastapi import FastAPI, Query
from fastapi.encoders import jsonable_encoder
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import Roll, SessionDep

app = FastAPI()

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

import os

app.mount("/%thumbnails%", 
          StaticFiles(directory=os.path.join(os.path.dirname(__file__), "../notebooks/data")), 
          name="videos")
app.mount("/%fit%", 
          StaticFiles(directory=os.path.join(os.path.dirname(__file__), "../notebooks/data")), 
          name="videos")
app.mount("/%videos%", 
          StaticFiles(directory=os.path.join(os.path.dirname(__file__), "../../../videos")), 
          name="videos")