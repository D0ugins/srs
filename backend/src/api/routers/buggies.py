from db.database import Buggy
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep

router = APIRouter(prefix="/buggies", tags=["buggies"])

@router.get("")
def get_buggies(
    session: SessionDep,
    # skip: int = Query(0, ge=0),
    # limit: int = Query(100, ge=1, le=1000)
):
    query = select(Buggy)
    buggies = session.scalars(query).all()
    return buggies

@router.get("/{buggy_id}")
def get_buggy(buggy_id: int, session: SessionDep):
    query = select(Buggy).options(
        selectinload(Buggy.rolls)
    ).where(Buggy.id == buggy_id)
    
    buggy = session.scalar(query)
    if not buggy:
        raise HTTPException(status_code=404, detail="Buggy not found")
    
    return buggy
