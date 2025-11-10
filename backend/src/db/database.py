import os
from typing import Annotated, Optional, List
from datetime import datetime, timezone
from enum import Enum
from fastapi import Depends
from sqlmodel import SQLModel, Field, create_engine, Relationship, Session
from sqlalchemy import event, Index, CheckConstraint
from sqlalchemy.orm import Session as SQLAlchemySession

DB_PATH = f'sqlite:///{os.path.join(os.path.dirname(__file__), "../../srs.db")}'
engine = create_engine(DB_PATH, connect_args={"check_same_thread": False})

class TimestampModel(SQLModel):
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)

class Driver(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    
    rolls: List["Roll"] = Relationship(back_populates="driver")

class Gender(str, Enum):
    M = "M"
    W = "W"
    AG = "AG"

class Pusher(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    name: Optional[str]
    gender: Optional[Gender] = None
    
    roll_hills: List["RollHill"] = Relationship(back_populates="pusher")

class Buggy(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    name: str
    abbreviation: str = Field(unique=True)
    
    rolls: List["Roll"] = Relationship(back_populates="buggy")

class Sensor(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    type: str
    name: str
    abbreviation: str = Field(unique=True)
    uri: Optional[str] = Field(default=None)
    
    roll_files: List["RollFile"] = Relationship(back_populates="sensor")

class RollType(str, Enum):
    WEEKEND = "weekend"
    MIDNIGHT = "midnight"
    
class RollDate(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    year: int
    month: int
    day: int
    notes: str = ""
    temperature: Optional[int] = Field(default=None)
    humidity: Optional[int] = Field(default=None)
    type: RollType
    
    __table_args__ = (Index("idx_roll_date_ymd", "year", "month", "day", "type", unique=True),)
    
    rolls: List["Roll"] = Relationship(back_populates="roll_date")


class Roll(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    driver_id: int = Field(foreign_key="driver.id", index=True)
    buggy_id: int = Field(foreign_key="buggy.id", index=True)
    roll_date_id: int = Field(foreign_key="rolldate.id", index=True)
    
    roll_number: Optional[int]
    start_time: Optional[datetime]
    driver_notes: str = ""
    mech_notes: str = ""
    pusher_notes: str = ""
    
    
    driver: Driver = Relationship(back_populates="rolls")
    buggy: Buggy = Relationship(back_populates="rolls")
    roll_date: RollDate = Relationship(back_populates="rolls")
    roll_files: List["RollFile"] = Relationship(back_populates="roll")
    roll_events: List["RollEvent"] = Relationship(back_populates="roll")
    roll_hills: List["RollHill"] = Relationship(back_populates="roll")
    __table_args__ = (
        CheckConstraint(
            "roll_number IS NOT NULL OR start_time IS NOT NULL",
            name="ck_roll_roll_number_or_start_time",
        ),
        Index("idx_roll_unique_per_date", "roll_date_id", "buggy_id", "roll_number", "start_time", unique=True)
    )

class RollFile(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    roll_id: int = Field(foreign_key="roll.id", index=True)
    type: str
    uri: str
    sensor_id: Optional[int] = Field(foreign_key="sensor.id")
    
    roll: Roll = Relationship(back_populates="roll_files")
    sensor: Optional[Sensor] = Relationship(back_populates="roll_files")

class RollEvent(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    roll_id: int = Field(foreign_key="roll.id", index=True)
    type: str
    tag: Optional[str]
    timestamp_ms: int
    raw_timestamp: Optional[datetime]
    
    roll: Roll = Relationship(back_populates="roll_events")

class RollHill(TimestampModel, table=True):
    id: int = Field(default=None, primary_key=True)
    roll_id: int = Field(foreign_key="roll.id", index=True)
    pusher_id: Optional[int] = Field(foreign_key="pusher.id", index=True)
    
    roll: Roll = Relationship(back_populates="roll_hills")
    pusher: Optional[Pusher] = Relationship(back_populates="roll_hills")

@event.listens_for(SQLAlchemySession, 'before_flush')
def receive_before_flush(session: SQLAlchemySession, flush_context, instances):
    for instance in session.dirty:
        if isinstance(instance, TimestampModel):
            instance.updated_at = datetime.now(timezone.utc)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
        
SessionDep = Annotated[Session, Depends(get_session)]

if __name__ == "__main__":
    create_db_and_tables()