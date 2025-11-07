import os
from typing import Annotated, Optional, List
from datetime import datetime, timezone
from enum import Enum
from fastapi import Depends
from sqlmodel import SQLModel, Field, create_engine, Relationship, Session
from sqlalchemy import event
from sqlalchemy.orm import Session as SQLAlchemySession

DB_PATH = f'sqlite:///{os.path.join(os.path.dirname(__file__), "srs.db")}'
engine = create_engine(DB_PATH, connect_args={"check_same_thread": False})

class TimestampModel(SQLModel):
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)

class Driver(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    
    rolls: List["Roll"] = Relationship(back_populates="driver")

class Gender(str, Enum):
    M = "M"
    W = "W"
    AG = "AG"

class Pusher(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: Optional[str]
    gender: Optional[Gender] = None
    
    roll_hills: List["RollHill"] = Relationship(back_populates="pusher")

class Buggy(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    abbreviation: str = Field(unique=True)
    
    rolls: List["Roll"] = Relationship(back_populates="buggy")

class Sensor(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    type: str
    name: str
    abbreviation: str = Field(unique=True)
    uri: Optional[str]
    
    roll_files: List["RollFile"] = Relationship(back_populates="sensor")

class RollDate(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    date: datetime
    notes: str = ""
    temperature: Optional[int]
    humidity: Optional[int]
    
    rolls: List["Roll"] = Relationship(back_populates="roll_date")

class RollType(str, Enum):
    WEEKEND = "weekend"
    MIDNIGHT = "midnight"

class Roll(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    driver_id: int = Field(foreign_key="driver.id", index=True)
    buggy_id: int = Field(foreign_key="buggy.id", index=True)
    roll_date_id: int = Field(foreign_key="rolldate.id", index=True)
    roll_type: RollType
    
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

class RollFile(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    roll_id: int = Field(foreign_key="roll.id", index=True)
    type: str
    uri: str
    sensor_id: Optional[int] = Field(foreign_key="sensor.id")
    
    roll: Roll = Relationship(back_populates="roll_files")
    sensor: Optional[Sensor] = Relationship(back_populates="roll_files")

class RollEvent(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    roll_id: int = Field(foreign_key="roll.id", index=True)
    type: str
    tag: Optional[str]
    timestamp_ms: int
    raw_timestamp: Optional[datetime]
    
    roll: Roll = Relationship(back_populates="roll_events")

class RollHill(TimestampModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
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