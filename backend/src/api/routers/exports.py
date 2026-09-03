from io import StringIO
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep
from db.database import File, Roll, RollHill, RollStat

router = APIRouter(prefix="/exports", tags=["exports"])

HILL_KEYS = ['time.hill_1-hill_2', 'time.hill_2-crosswalk', 'time.hill_3-hill_4',
             'time.hill_4-hill_5', 'time.hill_5-finish_line']


def _stats(session):
    """{roll_id: {quantity: value}} from the cached RollStat rows (status ok), racebox preferred.
    Reads only -- a corpus-wide export must not trigger recomputes."""
    rows = session.execute(select(RollStat.roll_id, RollStat.quantity, RollStat.value, File.type)
                           .join(File, File.id == RollStat.source_id)
                           .where(RollStat.status == 'ok')).all()
    by = {}
    for roll, q, v, ftype in rows:
        by.setdefault((roll, 'racebox' if 'racebox' in ftype else 'pnp'), {})[q] = v
    return {r: by.get((r, 'racebox')) or by.get((r, 'pnp')) or {} for r, _ in by}


def _fmt(q, key, nd=2):
    v = q.get(key)
    return '' if v is None else f'{v:.{nd}f}'

@router.get("/hills.csv")
def export_hills(
    session: SessionDep,
):
    query = select(Roll).options(
        selectinload(Roll.driver),
        selectinload(Roll.buggy),
        selectinload(Roll.roll_date),
        selectinload(Roll.roll_hills).selectinload(RollHill.pusher),
    )
    
    rolls = session.scalars(query).all()
    stats = _stats(session)
    
    output = StringIO()
    output.write("Id,Buggy,Driver,Pusher,Gender,Hill,Date,Time,Roll Type,Roll Number,Roll Start Time UTC\n")
    
    for roll in rolls:
        q = stats.get(roll.id, {})
        date_str = f"{roll.roll_date.year}/{roll.roll_date.month:02d}/{roll.roll_date.day:02d}"
        start_time = roll.start_time.strftime("%H:%M") if roll.start_time else ""
        roll_number = str(roll.roll_number) if roll.roll_number is not None else ""
        
        hill_map = {rh.hill_number: rh for rh in roll.roll_hills}
        
        for hill_number in range(1, 6):
            roll_hill = hill_map.get(hill_number)
            time_s = q.get(HILL_KEYS[hill_number - 1])
            
            if roll_hill is None and time_s is None:
                continue
            if roll_hill is not None and roll_hill.pusher.name == "MECH":
                continue
            
            time_str = f"{time_s:.1f}" if time_s is not None else ""
            pusher_name = roll_hill.pusher.name if roll_hill is not None else ""
            gender = roll_hill.pusher.gender.value if roll_hill is not None and roll_hill.pusher.gender else ""
            
            row = [
                str(roll.id), roll.buggy.name, roll.driver.name,
                pusher_name, gender,
                str(hill_number),
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
    )
    
    rolls = session.scalars(query).all()
    stats = _stats(session)
    
    output = StringIO()
    output.write("Id,Buggy,Driver,Date,Roll Number,Roll Start Time,Time,Max Speed,Max Energy,"
                 "To Chute Energy Loss,Chute Energy Loss,Freeroll Energy Loss,Pickup Speed,"
                 "Pickup Arc,Crosswalk Speed,Chute Speed,To Stop Sign Time,From Stop Sign Time\n")
    
    for roll in rolls:
        date_str = f"{roll.roll_date.year}/{roll.roll_date.month:02d}/{roll.roll_date.day:02d}"
        start_time = roll.start_time.strftime("%H:%M") if roll.start_time else ""
        roll_number = str(roll.roll_number) if roll.roll_number is not None else ""
        
        q = stats.get(roll.id, {})
        row = [
            str(roll.id), roll.buggy.name, roll.driver.name,
            date_str, roll_number, start_time,
            _fmt(q, 'time.crosswalk-hill_3', 1),
            _fmt(q, 'max_speed'), _fmt(q, 'max_energy'),
            _fmt(q, 'eloss.crosswalk-chute_start'), _fmt(q, 'eloss.chute_start-hill_3'),
            _fmt(q, 'eloss.crosswalk-hill_3'),
            _fmt(q, 'pickup.speed'), _fmt(q, 'pickup.arc', 1),
            _fmt(q, 'speed.crosswalk'), _fmt(q, 'speed.chute_start'),
            _fmt(q, 'time.crosswalk-stop_sign', 1), _fmt(q, 'time.stop_sign-hill_3', 1),
        ]
        output.write(",".join(row) + "\n")
    
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=freerolls.csv"}
    )

