import os
from typing import Annotated, Optional, List
from datetime import datetime, timezone
from enum import Enum
from fastapi import Depends
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Index, CheckConstraint, Enum as SQLEnum, event
from sqlalchemy.orm import declarative_base, relationship, Session

DB_PATH = f'sqlite:///app/data/db/srs.db'
engine = create_engine(DB_PATH, connect_args={"check_same_thread": False})

Base = declarative_base()

class TimestampModel(Base):
    __abstract__ = True
    
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, 
                        default=lambda: datetime.now(timezone.utc), 
                        onupdate=lambda: datetime.now(timezone.utc))

class Driver(TimestampModel):
    __tablename__ = "driver"
    
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    
    rolls = relationship("Roll", back_populates="driver")
    
    def __repr__(self):
        return f"Driver(id={self.id}, name='{self.name}')"

class Gender(str, Enum):
    M = "M"
    W = "W"
    AG = "AG"

class Pusher(TimestampModel):
    __tablename__ = "pusher"
    
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=True)
    gender = Column(SQLEnum(Gender), nullable=True)
    
    roll_hills = relationship("RollHill", back_populates="pusher")
    
    def __repr__(self):
        return f"Pusher(id={self.id}, name='{self.name}', gender={self.gender})"

class Buggy(TimestampModel):
    __tablename__ = "buggy"
    
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    abbreviation = Column(String, unique=True, nullable=False)
    
    rolls = relationship("Roll", back_populates="buggy")
    
    def __repr__(self):
        return f"Buggy(id={self.id}, name='{self.name}', abbreviation='{self.abbreviation}')"

class Sensor(TimestampModel):
    __tablename__ = "sensor"
    
    id = Column(Integer, primary_key=True)
    type = Column(String, nullable=False)
    name = Column(String, nullable=False)
    abbreviation = Column(String, unique=True, nullable=False)
    uri = Column(String, nullable=True)
    
    roll_files = relationship("RollFile", back_populates="sensor")
    
    def __repr__(self):
        return f"Sensor(id={self.id}, name='{self.name}', type='{self.type}')"

class RollType(str, Enum):
    WEEKEND = "weekend"
    MIDNIGHT = "midnight"
    
class RollDate(TimestampModel):
    __tablename__ = "rolldate"
    
    id = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    day = Column(Integer, nullable=False)
    notes = Column(String, default="", nullable=False)
    temperature = Column(Integer, nullable=True)
    humidity = Column(Integer, nullable=True)
    type = Column(SQLEnum(RollType), nullable=False)
    
    __table_args__ = (Index("idx_roll_date_ymd", "year", "month", "day", "type", unique=True),)
    
    rolls = relationship("Roll", back_populates="roll_date")
    
    def __repr__(self):
        return f"RollDate(id={self.id}, date={self.year}-{self.month:02d}-{self.day:02d}, type={self.type})"


class Roll(TimestampModel):
    __tablename__ = "roll"
    
    id = Column(Integer, primary_key=True)
    driver_id = Column(Integer, ForeignKey("driver.id"), nullable=False, index=True)
    buggy_id = Column(Integer, ForeignKey("buggy.id"), nullable=False, index=True)
    roll_date_id = Column(Integer, ForeignKey("rolldate.id"), nullable=False, index=True)
    
    roll_number = Column(Integer, nullable=True)
    start_time = Column(DateTime, nullable=True)
    driver_notes = Column(String, default="", nullable=False)
    mech_notes = Column(String, default="", nullable=False)
    pusher_notes = Column(String, default="", nullable=False)
    
    driver = relationship("Driver", back_populates="rolls")
    buggy = relationship("Buggy", back_populates="rolls")
    roll_date = relationship("RollDate", back_populates="rolls")
    roll_files = relationship("RollFile", back_populates="roll")
    roll_events = relationship("RollEvent", back_populates="roll")
    roll_hills = relationship("RollHill", back_populates="roll")
    
    __table_args__ = (
        CheckConstraint(
            "roll_number IS NOT NULL OR start_time IS NOT NULL",
            name="ck_roll_roll_number_or_start_time",
        ),
        Index("idx_roll_unique_per_date", "roll_date_id", "buggy_id", "roll_number", "start_time", unique=True)
    )
    
    def __repr__(self):
        return f"Roll(id={self.id}, roll_number={self.roll_number}, driver_id={self.driver_id}, buggy_id={self.buggy_id})"

class RollFile(TimestampModel):
    __tablename__ = "rollfile"
    
    id = Column(Integer, primary_key=True)
    roll_id = Column(Integer, ForeignKey("roll.id"), nullable=False, index=True)
    type = Column(String, nullable=False)
    uri = Column(String, nullable=False)
    sensor_id = Column(Integer, ForeignKey("sensor.id"), nullable=True)
    
    roll = relationship("Roll", back_populates="roll_files")
    sensor = relationship("Sensor", back_populates="roll_files")
    
    def __repr__(self):
        return f"RollFile(id={self.id}, roll_id={self.roll_id}, type='{self.type}')"

class RollEvent(TimestampModel):
    __tablename__ = "rollevent"
    
    id = Column(Integer, primary_key=True)
    roll_id = Column(Integer, ForeignKey("roll.id"), nullable=False, index=True)
    type = Column(String, nullable=False)
    tag = Column(String, nullable=True)
    timestamp_ms = Column(Integer, nullable=False)
    raw_timestamp = Column(DateTime, nullable=True)
    
    roll = relationship("Roll", back_populates="roll_events")
    
    def __repr__(self):
        return f"RollEvent(id={self.id}, roll_id={self.roll_id}, type='{self.type}', timestamp_ms={self.timestamp_ms})"

class RollHill(TimestampModel):
    __tablename__ = "rollhill"
    
    id = Column(Integer, primary_key=True)
    roll_id = Column(Integer, ForeignKey("roll.id"), nullable=False, index=True)
    pusher_id = Column(Integer, ForeignKey("pusher.id"), nullable=True, index=True)
    
    roll = relationship("Roll", back_populates="roll_hills")
    pusher = relationship("Pusher", back_populates="roll_hills")
    
    def __repr__(self):
        return f"RollHill(id={self.id}, roll_id={self.roll_id}, pusher_id={self.pusher_id})"

def create_db_and_tables():
    Base.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
        
SessionDep = Annotated[Session, Depends(get_session)]

if __name__ == "__main__":
    create_db_and_tables()