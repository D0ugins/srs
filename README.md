# SRS

Collection of tools for recording and analyzing rolls

## SRS Recording Surveyor

Main web UI for viewing and analyzing rolls. [More information](https://docs.google.com/document/d/1dIadUSLrxL2oTqxEv8UGYbaSsMx7pDwcmHm6EAhIqW0/edit?tab=t.0)

To run with docker, upload the data folders referenced in `compose.yaml` and run `docker compose up --build`. 

For hot reloading during development, use `docker compose up --build --watch`[^1]

[^1]: At the moment hot reloading of the backend doesn't work while a video is playing on the frontend. Reload the page in the browser to allow the backend to restart

To create a new empty database, run `docker compose up --build create_db`

### SRS Roll Shower
Frontend is written in React with tanstack query and router using Typescript. Tailwind is used for styling

The frontend uses [Visx](https://visx.airbnb.tech) and d3 to draw the charts.

Copy the `.env.sample` file to a `.env` file with the relevant fields before running

When creating a new route, run `npm run dev` locally once to update `routeTree.gen.ts` for tanStack router

To build, run `npx vite build`, make sure to set the base path if needed

### SRS Roll Server
The backend is written in python and uses FastAPI to handle http requests, and sqlalchemy to read from an sqlite database file.

The API uses pydantic to validate inputs to requests.

Packages are managed with `uv`


### SRS Recorded Stuff

If you want a copy of the data message me on slack or email me at yshabazz@andrew.cmu.edu

Data is stored in the `./data` folder

- `./data/videos/`: Video files from Virbs or other sources
- `./data/virbs/`: FIT sensor data files from virbs.
- `./data/geo/`: Geographic data such as a kml file of the course and GeoTiff of course elevation
- `./data/db/`: folder for storing sqlite db files
- `./data/cache/`: Cached data, mainly used for caching parsed FIT files

## SRS Research Scripts

Jupyter notebooks for analyzing roll data.

Currently located in `./backend/src/notebooks` to share dependencies and utility functions with the api.

### SRS Reentry Script

The notebook at `./backend/src/notebooks/load.ipynb` contains a script to load data from VirbEdit's folders into an empty database. It loads the lower resolution video previews and the FIT files into the database, as well as metadata about the roll. Assumes that all existing VirbEdit projects were saved with the standard naming format.

Also tries to estimate the timestamps of various events based on FIT file data.

### SRS Random Shenanigans

Various scripts, currently primarily focused on analyzing sensor data from VIRBS (note that this data is very low quality, so this is mostly for prototyping purposes)

Uses `garmin_fit_sdk` to load virb FIT files. Uses `geopandas`/`shapely` for dealing with kml data, uses `rasterio` for geotiff data.

Pretty disorganized at the moment, feel free to ask any questions


