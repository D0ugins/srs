from db.database import Pusher
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep

router = APIRouter(prefix="/pushers", tags=["pushers"])

@router.get("")
def get_pushers(
    session: SessionDep,
):
    query = select(Pusher)
    pushers = session.scalars(query).all()
    return pushers

@router.get("/{pusher_id}")
def get_pusher(pusher_id: int, session: SessionDep):
    query = select(Pusher).options(
        selectinload(Pusher.roll_hills)
    ).where(Pusher.id == pusher_id)
    
    pusher = session.scalar(query)
    if not pusher:
        raise HTTPException(status_code=404, detail="Pusher not found")
    
    return pusher
