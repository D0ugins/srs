from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
from api.routers import rolls, drivers, buggies, pushers, sensors, file, exports
from lib.racebox import load_session

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rolls.router)
app.include_router(drivers.router)
app.include_router(buggies.router)
app.include_router(pushers.router)
app.include_router(sensors.router)
app.include_router(file.router)
app.include_router(exports.router)

app.mount("/[[thumbnails]]", 
          StaticFiles(directory='/app/data/virbs'), 
          name="thumbnails")
app.mount("/[[fit]]", 
          StaticFiles(directory=os.path.join(os.path.dirname(__file__), "/app/data/virbs")), 
          name="fit")
app.mount("/[[videos]]", 
          StaticFiles(directory=os.path.join(os.path.dirname(__file__), "/app/data/videos")), 
          name="videos")

@app.get("/[[racebox]]/{session_id}")
def get_racebox_session(session_id: str):
    return load_session(session_id)
