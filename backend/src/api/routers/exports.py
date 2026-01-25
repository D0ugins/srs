from io import StringIO
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from lib.events import calculate_hill_times, calculate_freeroll_stats
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
                roll.buggy.name, roll.driver.name,
                roll_hill.pusher.name, gender,
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


@router.get("/freerolls.csv")
def export_freeroll(
    session: SessionDep,
):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_date),
        selectinload(Roll.roll_events),
        selectinload(Roll.roll_files),
    )
    
    rolls = session.scalars(query).all()
    
    output = StringIO()
    output.write("Buggy,Driver,Date,Roll Number,Roll Start Time,Time,Max Speed,Max Energy,Energy Loss,Pickup Energy,Pickup Speed,Rollup Height\n")
    
    for roll in rolls:
        date_str = f"{roll.roll_date.year}/{roll.roll_date.month:02d}/{roll.roll_date.day:02d}"
        start_time = roll.start_time.strftime("%H:%M") if roll.start_time else ""
        roll_number = str(roll.roll_number) if roll.roll_number is not None else ""
        
        fit_files = [rf for rf in roll.roll_files if rf.type == 'fit']
        fit_file = fit_files[0].uri.replace('[[fit]]', 'virbs') if len(fit_files) == 1 else None
        
        stats = calculate_freeroll_stats(fit_file, roll.roll_events)
        
        freeroll_time = f"{stats['freeroll_time_ms'] / 1000:.1f}" if 'freeroll_time_ms' in stats else ""
        max_speed = f"{stats['max_speed']:.2f}" if 'max_speed' in stats else ""
        max_energy = f"{stats['max_energy']:.2f}" if 'max_energy' in stats else ""
        freeroll_energy_loss = f"{stats['freeroll_energy_loss']:.2f}" if 'freeroll_energy_loss' in stats else ""
        pickup_energy = f"{stats['pickup_energy']:.2f}" if 'pickup_energy' in stats else ""
        pickup_speed = f"{stats['pickup_speed']:.2f}" if 'pickup_speed' in stats else ""
        rollup_height = f"{stats['rollup_height']:.2f}" if 'rollup_height' in stats else ""
        
        row = [
            roll.buggy.name, roll.driver.name,
            date_str, roll_number, start_time,
            freeroll_time,
            max_speed, max_energy,
            freeroll_energy_loss,
            pickup_energy, pickup_speed, rollup_height,
        ]
        output.write(",".join(row) + "\n")
    
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=freerolls.csv"}
    )

