from io import StringIO
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from lib.events import calculate_hill_times
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep
from db.database import Roll, RollHill, RollEvent

router = APIRouter(prefix="/exports", tags=["exports"])

@router.get("/hills.csv")
def export_hills(
    session: SessionDep,
):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_date),
        selectinload(Roll.roll_events),
        selectinload(Roll.roll_hills).selectinload(RollHill.pusher),
    )
    
    rolls = session.scalars(query).all()
    
    output = StringIO()
    output.write("Buggy,Driver,Pusher,Gender,Hill,Date,Time,Roll Type,Roll Number,Roll Start Time\n")
    
    for roll in rolls:
        hill_times = calculate_hill_times(roll.roll_events)
        date_str = f"{roll.roll_date.year}/{roll.roll_date.month:02d}/{roll.roll_date.day:02d}"
        
        for roll_hill in roll.roll_hills:
            if roll_hill.pusher.name == "MECH": continue
            
            time_ms = hill_times.get(roll_hill.hill_number)
            time_str = f"{time_ms / 1000:.1f}" if time_ms is not None else ""
            gender = roll_hill.pusher.gender.value if roll_hill.pusher.gender else ""
            start_time = roll.start_time.strftime("%H:%M") if roll.start_time else ""
            roll_number = str(roll.roll_number) if roll.roll_number is not None else ""
            
            row = [
                roll.buggy.name,
                roll.driver.name,
                roll_hill.pusher.name,
                gender,
                str(roll_hill.hill_number),
                date_str,
                time_str,
                roll.roll_date.type.value,
                roll_number,
                start_time,
            ]
            output.write(",".join(row) + "\n")
    
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=hills.csv"}
    )

