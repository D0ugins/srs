import os
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, DateTime, ForeignKey, text, func

DB_PATH = f'sqlite:///{os.path.join(os.path.dirname(__file__), "srs.db")}'
engine = create_engine(DB_PATH)
metadata = MetaData()



driver_table = Table(
    'driver', metadata,
    Column('id', Integer, primary_key=True),
    Column('name', String, nullable=False, unique=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)

pusher_table = Table(
    'pusher', metadata,
    Column('id', Integer, primary_key=True),
    Column('name', String, nullable=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)


buggy_table = Table(
    'buggy', metadata,
    Column('id', Integer, primary_key=True),
    Column('name', String, nullable=False),
    Column('abbreviation', String, nullable=False, unique=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)

sensor_table = Table(
    'sensor', metadata,
    Column('id', Integer, primary_key=True),
    Column('type', String, nullable=False),
    Column('name', String, nullable=False),
    Column('abbreviation', String, nullable=False, unique=True),
    Column('ip', String, nullable=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)


roll_date_table = Table(
    'roll_date', metadata,
    Column('id', Integer, primary_key=True),
    Column('date', DateTime, nullable=False),
    Column('notes', String, default=""),
    Column('temperature', Integer, nullable=True),
    Column('humidity', Integer, nullable=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)

roll_table = Table(
    'roll', metadata,
    Column('id', Integer, primary_key=True),
    Column('driver_id', Integer, ForeignKey('driver.id'), nullable=False, index=True),
    Column('buggy_id', Integer, ForeignKey('buggy.id'), nullable=False, index=True),
    Column('roll_date_id', Integer, ForeignKey('roll_date.id'), nullable=False, index=True),
    
    Column('roll_number', Integer, nullable=True),
    Column('start_time', DateTime, nullable=True),
    
    Column('driver_notes', String, default=""),
    Column('mech_notes', String, default=""),
    Column('pusher_notes', String, default=""),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)
   
roll_file_table = Table(
    'roll_file', metadata,
    Column('id', Integer, primary_key=True),
    Column('roll_id', Integer, ForeignKey('roll.id'), nullable=False, index=True),
    
    Column('type', String, nullable=False),
    Column('uri', String, nullable=False),
    
    Column('sensor_id', Integer, ForeignKey('sensor.id'), nullable=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)

roll_event_table = Table(
    'roll_event', metadata,
    Column('id', Integer, primary_key=True),
    Column('roll_id', Integer, ForeignKey('roll.id'), nullable=False, index=True),
    
    Column('type', String, nullable=False),
    Column('timestamp_ms', Integer, nullable=False),
    Column('raw_timestamp', DateTime, nullable=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)

roll_hill_table = Table(
    'roll_hill', metadata,
    Column('id', Integer, primary_key=True),
    Column('roll_id', Integer, ForeignKey('roll.id'), nullable=False, index=True),
    Column('pusher_id', Integer, ForeignKey('pusher.id'), nullable=True, index=True),
    
    Column('created_at', DateTime, server_default=func.now()),
    Column('updated_at', DateTime, onupdate=func.now(), server_default=func.now())
)

metadata.create_all(engine)

def get_connection():
    conn = engine.connect()
    conn.execute(text("PRAGMA foreign_keys=ON"))
    return conn