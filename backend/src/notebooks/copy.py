import shutil
from tqdm import tqdm
import json
import os

DATA_PATH = '../../../data'
GDRIVE_PATH = '/home/yusuf/cmu/etc/mnt/srs'
EXT_DRIVE_PATH = '/media/yusuf/srs_data'

with open(f'{DATA_PATH}/archive/gdrive_videos.json', 'r') as f:
    edited_video_files = json.load(f)
len(edited_video_files)

for path in tqdm(edited_video_files):
  folder = "edited_vids/" + "/".join(path.split("/")[:-1])
  if not os.path.exists(f"{EXT_DRIVE_PATH}/{folder}"):
    os.makedirs(f"{EXT_DRIVE_PATH}/{folder}")
  shutil.copy2(f"{GDRIVE_PATH}/{path}", f"{EXT_DRIVE_PATH}/edited_vids/{path}")