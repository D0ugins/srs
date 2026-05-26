from db.database import File
from fastapi import APIRouter
from sqlalchemy import select, distinct
from db import SessionDep

router = APIRouter(prefix="/files", tags=["files"])

@router.get("/types")
def get_file_types(session: SessionDep):
    """Get all distinct file types from roll files"""
    query = select(distinct(File.type)).order_by(File.type)
    file_types = session.scalars(query).all()
    return file_types
