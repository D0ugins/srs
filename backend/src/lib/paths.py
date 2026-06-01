def resolve_path(path: str) -> str:
    if path.startswith("[[thumbnails]]/"):
        return path.replace("[[thumbnails]]/", "/app/data/virbs/")
    elif path.startswith("[[fit]]/"):
        return path.replace("[[fit]]/", "/app/data/virbs/")
    elif path.startswith("[[videos]]/"):
        return path.replace("[[videos]]/", "/app/data/videos/")
    elif path.startswith("[[archive]]/"):
        return path.replace("[[archive]]/", "/app/data/archive/")
    elif path.startswith("[[gdrive]]/"):
        return path.replace("[[gdrive]]/", "/app/data/gdrive/")
    else:
        raise ValueError(f"Unrecognized path prefix in {path}")