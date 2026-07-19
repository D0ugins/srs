from db.database import Buggy
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from db import SessionDep

router = APIRouter(prefix="/buggies", tags=["buggies"])

class BuggyInput(BaseModel):
    name: str
    abbreviation: str

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

def validate_buggy_input(buggy_data: BuggyInput, session: SessionDep, exclude_id: int | None = None):
    name = buggy_data.name.strip()
    abbreviation = buggy_data.abbreviation.strip()
    if not name or not abbreviation:
        raise HTTPException(status_code=400, detail="Name and abbreviation cannot be empty")
    query = select(Buggy).where(Buggy.abbreviation == abbreviation)
    if exclude_id is not None:
        query = query.where(Buggy.id != exclude_id)
    if session.scalar(query):
        raise HTTPException(status_code=409, detail="A buggy with that abbreviation already exists")
    return name, abbreviation

@router.post("")
def create_buggy(buggy_data: BuggyInput, session: SessionDep):
    name, abbreviation = validate_buggy_input(buggy_data, session)
    buggy = Buggy(name=name, abbreviation=abbreviation)
    session.add(buggy)
    session.commit()
    session.refresh(buggy)
    return buggy

@router.put("/{buggy_id}")
def update_buggy(buggy_id: int, buggy_data: BuggyInput, session: SessionDep):
    buggy = session.get(Buggy, buggy_id)
    if not buggy:
        raise HTTPException(status_code=404, detail="Buggy not found")
    name, abbreviation = validate_buggy_input(buggy_data, session, exclude_id=buggy_id)
    buggy.name = name
    buggy.abbreviation = abbreviation
    session.commit()
    session.refresh(buggy)
    return buggy

@router.delete("/{buggy_id}")
def delete_buggy(buggy_id: int, session: SessionDep):
    buggy = session.get(Buggy, buggy_id)
    if not buggy:
        raise HTTPException(status_code=404, detail="Buggy not found")
    if buggy.rolls:
        raise HTTPException(status_code=409, detail=f"Buggy has {len(buggy.rolls)} linked roll(s)")
    session.delete(buggy)
    session.commit()
    return {"ok": True}
