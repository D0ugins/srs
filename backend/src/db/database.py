import os
from typing import Annotated
from datetime import datetime, timezone
from enum import Enum
from fastapi import Depends
from sqlalchemy import create_engine, Index, CheckConstraint, event, ForeignKey
from sqlalchemy.orm import declarative_base, relationship, Session, Mapped, mapped_column

DATA_PATH = os.getenv('DATA_PATH', '/app/data')
DB_PATH = os.getenv('DB_PATH', f'{DATA_PATH}/db/srs.db')
DB_URI = f'sqlite:///{DB_PATH}'
engine = create_engine(DB_URI, connect_args={"check_same_thread": False})

Base = declarative_base()

class TimestampModel(Base):
    __abstract__ = True
    
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(nullable=False, 
                        default=lambda: datetime.now(timezone.utc), 
                        onupdate=lambda: datetime.now(timezone.utc))

class Driver(TimestampModel):
    __tablename__ = "driver"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True, index=True)
    
    rolls: Mapped[list["Roll"]] = relationship(back_populates="driver")
    
    def __repr__(self):
        return f"Driver(id={self.id}, name='{self.name}')"

class Gender(str, Enum):
    M = "M"
    W = "W"
    AG = "AG"

class Pusher(TimestampModel):
    __tablename__ = "pusher"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True, index=True)
    gender: Mapped[Gender | None] = mapped_column()
    
    roll_hills: Mapped[list["RollHill"]] = relationship(back_populates="pusher")
    
    def __repr__(self):
        return f"Pusher(id={self.id}, name='{self.name}', gender={self.gender})"

class Buggy(TimestampModel):
    __tablename__ = "buggy"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column()
    abbreviation: Mapped[str] = mapped_column(unique=True, index=True)
    
    rolls: Mapped[list["Roll"]] = relationship(back_populates="buggy")
    
    def __repr__(self):
        return f"Buggy(id={self.id}, name='{self.name}', abbreviation='{self.abbreviation}')"

class Sensor(TimestampModel):
    __tablename__ = "sensor"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column()
    name: Mapped[str] = mapped_column()
    abbreviation: Mapped[str] = mapped_column(unique=True)
    uri: Mapped[str | None] = mapped_column()
    
    roll_files: Mapped[list["RollFile"]] = relationship(back_populates="sensor")
    
    def __repr__(self):
        return f"Sensor(id={self.id}, name='{self.name}', type='{self.type}')"

class RollType(str, Enum):
    WEEKEND = "weekend"
    MIDNIGHT = "midnight"
    RACEDAY = "raceday"
    
class RollDate(TimestampModel):
    __tablename__ = "rolldate"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column()
    month: Mapped[int] = mapped_column()
    day: Mapped[int] = mapped_column()
    notes: Mapped[str] = mapped_column(default="")
    temperature: Mapped[int | None] = mapped_column()
    humidity: Mapped[int | None] = mapped_column()
    type: Mapped[RollType] = mapped_column()
    
    __table_args__ = (Index("idx_roll_date_ymd", "year", "month", "day", "type", unique=True),)
    
    rolls: Mapped[list["Roll"]] = relationship(back_populates="roll_date")
    
    def __repr__(self):
        return f"RollDate(id={self.id}, date={self.year}-{self.month:02d}-{self.day:02d}, type={self.type})"


class Roll(TimestampModel):
    __tablename__ = "roll"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("driver.id"), index=True)
    buggy_id: Mapped[int] = mapped_column(ForeignKey("buggy.id"), index=True)
    roll_date_id: Mapped[int] = mapped_column(ForeignKey("rolldate.id"), index=True)
    
    roll_number: Mapped[int | None] = mapped_column()
    start_time: Mapped[datetime | None] = mapped_column()
    driver_notes: Mapped[str] = mapped_column(default="")
    mech_notes: Mapped[str] = mapped_column(default="")
    pusher_notes: Mapped[str] = mapped_column(default="")
    
    driver: Mapped["Driver"] = relationship(back_populates="rolls")
    buggy: Mapped["Buggy"] = relationship(back_populates="rolls")
    roll_date: Mapped["RollDate"] = relationship(back_populates="rolls")
    roll_files: Mapped[list["RollFile"]] = relationship(back_populates="roll", cascade="delete, delete-orphan")
    roll_events: Mapped[list["RollEvent"]] = relationship(back_populates="roll", cascade="delete, delete-orphan")
    roll_hills: Mapped[list["RollHill"]] = relationship(back_populates="roll", cascade="delete, delete-orphan")
    
    __table_args__ = (
        CheckConstraint(
            "roll_number IS NOT NULL OR start_time IS NOT NULL",
            name="ck_roll_roll_number_or_start_time",
        ),
        Index("idx_roll_unique_per_date", "roll_date_id", "buggy_id", "roll_number", "start_time", unique=True)
    )
    
    def __repr__(self):
        return f"Roll(id={self.id}, roll_date_id={self.roll_date_id}, buggy_id={self.buggy_id}, driver_id={self.driver_id}, roll_number={self.roll_number})"

class RollFile(TimestampModel):
    __tablename__ = "rollfile"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    roll_id: Mapped[int] = mapped_column(ForeignKey("roll.id"), index=True)
    type: Mapped[str] = mapped_column(index=True)
    uri: Mapped[str] = mapped_column()
    sensor_id: Mapped[int | None] = mapped_column(ForeignKey("sensor.id"))
    
    roll: Mapped["Roll"] = relationship(back_populates="roll_files")
    sensor: Mapped["Sensor"] = relationship(back_populates="roll_files")
    
    __table_args__ = (Index("idx_rollfile_roll_type_uri", "roll_id", "type", "uri", unique=True),)
    
    def __repr__(self):
        return f"RollFile(id={self.id}, roll_id={self.roll_id}, type='{self.type}', uri='{self.uri}', sensor_id={self.sensor_id})"

class RollEvent(TimestampModel):
    __tablename__ = "rollevent"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    roll_id: Mapped[int] = mapped_column(ForeignKey("roll.id"), index=True)
    type: Mapped[str] = mapped_column()
    tag: Mapped[str | None] = mapped_column()
    timestamp_ms: Mapped[int] = mapped_column()
    raw_timestamp: Mapped[datetime | None] = mapped_column()
    
    roll: Mapped["Roll"] = relationship(back_populates="roll_events")
    
    __table_args__ = (Index("idx_rollevent_roll_type_tag_timestamp", "roll_id", "type", "tag", "timestamp_ms", unique=True),)
    
    def __repr__(self):
        return f"RollEvent(id={self.id}, roll_id={self.roll_id}, type='{self.type}', tag={self.tag!r}, timestamp_ms={self.timestamp_ms})"

class RollHill(TimestampModel):
    __tablename__ = "rollhill"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    roll_id: Mapped[int] = mapped_column(ForeignKey("roll.id"), index=True)
    pusher_id: Mapped[int] = mapped_column(ForeignKey("pusher.id"), index=True)
    hill_number: Mapped[int] = mapped_column()
    
    roll: Mapped["Roll"] = relationship(back_populates="roll_hills")
    pusher: Mapped["Pusher"] = relationship(back_populates="roll_hills")
    
    __table_args__ = (Index("idx_rollhill_roll_pusher_hillnum", "roll_id", "pusher_id", "hill_number", unique=True),)
    
    def __repr__(self):
        return f"RollHill(id={self.id}, roll_id={self.roll_id}, pusher_id={self.pusher_id}, hill_number={self.hill_number})"

def create_db_and_tables():
    Base.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
        
SessionDep = Annotated[Session, Depends(get_session)]

if __name__ == "__main__":
    create_db_and_tables()