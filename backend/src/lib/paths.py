import os
DATA_PATH = os.getenv('DATA_PATH', '/app/data')

def resolve_path(path: str) -> str:
    if path.startswith("[[thumbnails]]/"):
        return path.replace("[[thumbnails]]/", f"{DATA_PATH}/virbs/")
    elif path.startswith("[[fit]]/"):
        return path.replace("[[fit]]/", f"{DATA_PATH}/virbs/")
    elif path.startswith("[[videos]]/"):
        return path.replace("[[videos]]/", f"{DATA_PATH}/videos/")
    elif path.startswith("[[archive]]/"):
        return path.replace("[[archive]]/", f"{DATA_PATH}/archive/")
    elif path.startswith("[[gdrive]]/"):
        return path.replace("[[gdrive]]/", f"{DATA_PATH}/gdrive/")
    elif path.startswith("[[masks]]/"):
        return path.replace("[[masks]]/", f"{DATA_PATH}/masks/")
    elif path.startswith("[[traces]]/"):
        return path.replace("[[traces]]/", f"{DATA_PATH}/traces/")
    elif path.startswith("[[estimates]]/"):
        return path.replace("[[estimates]]/", f"{DATA_PATH}/estimates/")
    else:
        raise ValueError(f"Unrecognized path prefix in {path}")