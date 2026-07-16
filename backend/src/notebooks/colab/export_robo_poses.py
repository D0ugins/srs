# /// script
# requires-python = ">=3.11"
# dependencies = ["rosbags>=0.10", "mcap>=1.1", "numpy", "scipy", "av"]
# ///
"""Export pose priors from a robobuggy recording folder (data.mcap + vid.svo2) to poses.json.

The GQ7 EKF solution (/ekf/odometry_earth + /ekf/llh_position) is used for position/attitude;
/SC/self/state is avoided (its quaternion field holds Euler angles). The ZED host clock is not
always synced to the bag clock, so the video->bag offset is recovered by cross-correlating the
ZED's internal 400Hz gyro (embedded in the svo2) against the bag's /imu/data.

Usage: uv run export_robo_poses.py tmp/robo_data/1 [--out poses.json]
"""

import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from mcap.reader import make_reader
from rosbags.highlevel import AnyReader
from scipy.signal import fftconvolve

CALIB_URL = 'https://calib.stereolabs.com/?SN={}'
SYNC_FS = 50.0
SYNC_MIN_OVERLAP_S = 30.0
SYNC_MIN_CORR = 0.35
# GQ7 reports WGS84 ellipsoid height; the racebox pipeline uses USGS DEM (NAVD88) elevations.
# Calibrated as median(DEM - ellipsoid) over on-course samples of runs 0 and 2 (34.75/34.74);
# bundles geoid undulation (~+33.5m) minus antenna height above road (~0.9m).
ALT_OFFSET = 34.75


def read_svo(path):
    frame_ts, gyro_t, gyro = [], [], []
    header = {}
    serial = None
    with open(path, 'rb') as f:
        reader = make_reader(f)
        for schema, channel, msg in reader.iter_messages():
            if channel.topic == 'svo_header':
                d = json.loads(msg.data)
                header = {k: d[k] for k in ('ZED_SDK_version', 'version') if k in d}
            elif channel.topic.endswith('/side_by_side'):
                serial = channel.topic.split('/')[0].removeprefix('Camera_SN')
                frame_ts.append(msg.log_time)
            elif channel.topic.endswith('/sensors'):
                # packet layout (reverse-engineered): epoch ns at byte 16, gyro deg/s at 88:100
                buf = base64.b64decode(json.loads(msg.data)['data'])
                gyro_t.append(int.from_bytes(buf[16:24], 'little'))
                gyro.append(np.linalg.norm(np.frombuffer(buf[88:100], '<f4')))
    return {'frame_ts': np.array(frame_ts), 'gyro_t': np.array(gyro_t, float) / 1e9,
            'gyro': np.array(gyro), 'header': header, 'serial': serial}


def read_video_size(path):
    import av
    codec = av.CodecContext.create('h264', 'r')
    with open(path, 'rb') as f:
        reader = make_reader(f)
        for schema, channel, msg in reader.iter_messages():
            if not channel.topic.endswith('/side_by_side'):
                continue
            for pkt in codec.parse(msg.data[8:]):
                for frame in codec.decode(pkt):
                    return frame.width, frame.height
    raise RuntimeError('no decodable video frame found')


def read_bag(path):
    out = {'odom': [], 'llh': [], 'gnss2': [], 'imu': [], 'status': [], 'tf': {}}
    topics = ('/ekf/odometry_earth', '/ekf/llh_position', '/gnss_2/llh_position',
              '/imu/data', '/ekf/status', '/tf_static')
    with AnyReader([path]) as reader:
        conns = [c for c in reader.connections if c.topic in topics]
        missing = set(topics) - {c.topic for c in conns}
        if missing:
            sys.exit(f'bag is missing topics {sorted(missing)} (unsupported format?)')
        for conn, ts, raw in reader.messages(connections=conns):
            msg = reader.deserialize(raw, conn.msgtype)
            if conn.topic == '/tf_static':
                for t in msg.transforms:
                    tr = t.transform.translation
                    out['tf'][f'{t.header.frame_id}->{t.child_frame_id}'] = [tr.x, tr.y, tr.z]
                continue
            if conn.topic == '/ekf/status':
                out['status'].append((ts / 1e9, msg.gnss_state.strip('"'), msg.dual_antenna_fix_type.strip('"'),
                                      msg.filter_state.strip('"'), ','.join(f.strip('"') for f in msg.status_flags)))
                continue
            t = msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9
            if conn.topic == '/ekf/odometry_earth':
                p, o = msg.pose.pose.position, msg.pose.pose.orientation
                tw = msg.twist.twist.linear
                cov = np.array(msg.pose.covariance).reshape(6, 6).diagonal()
                out['odom'].append((t, p.x, p.y, p.z, o.x, o.y, o.z, o.w,
                                    np.sqrt(tw.x**2 + tw.y**2 + tw.z**2), *cov))
            elif conn.topic == '/ekf/llh_position':
                out['llh'].append((t, msg.latitude, msg.longitude, msg.altitude))
            elif conn.topic == '/gnss_2/llh_position':
                out['gnss2'].append((t, msg.latitude, msg.longitude, msg.altitude,
                                     msg.position_covariance[0], msg.position_covariance[8]))
            elif conn.topic == '/imu/data':
                w = msg.angular_velocity
                out['imu'].append((t, np.sqrt(w.x**2 + w.y**2 + w.z**2)))
    for k in ('odom', 'llh', 'gnss2', 'imu'):
        out[k] = np.array(out[k])
    return out


def sync_offset(zed_t, zed_gyro, bag_t, bag_gyro_rad):
    """Normalized cross-correlation with partial overlap. Returns (offset, corr, overlap_s):
    bag_time = video_time + offset."""
    zg = np.arange(zed_t[0], zed_t[-1], 1 / SYNC_FS)
    z = np.interp(zg, zed_t, zed_gyro)
    bg = np.arange(bag_t[0], bag_t[-1], 1 / SYNC_FS)
    b = np.interp(bg, bag_t, np.degrees(bag_gyro_rad))

    zr = z[::-1]
    ones_z, ones_b = np.ones(len(z)), np.ones(len(b))
    P = fftconvolve(b, zr)
    S1 = fftconvolve(ones_b, zr)
    S2 = fftconvolve(ones_b, (z**2)[::-1])
    T1 = fftconvolve(b, ones_z)
    T2 = fftconvolve(b**2, ones_z)
    N = fftconvolve(ones_b, ones_z)
    with np.errstate(invalid='ignore', divide='ignore'):
        r = (P - S1 * T1 / N) / np.sqrt((S2 - S1**2 / N) * (T2 - T1**2 / N))
    r[N < SYNC_MIN_OVERLAP_S * SYNC_FS] = np.nan
    i = np.nanargmax(r)
    delta = (bg[0] - zg[0]) + (i - (len(z) - 1)) / SYNC_FS
    return float(delta), float(r[i]), float(N[i] / SYNC_FS)


def fetch_calibration(serial):
    try:
        with urllib.request.urlopen(CALIB_URL.format(serial), timeout=15) as resp:
            return resp.read().decode()
    except Exception as e:
        print(f'warning: could not fetch factory calibration for SN{serial}: {e}')
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder', type=Path)
    ap.add_argument('--out', type=Path, default=None)
    ap.add_argument('--no-sync', action='store_true', help='assume clocks are already aligned')
    args = ap.parse_args()

    bag_path = next((p for n in ('data.mcap', 'data.bag') if (p := args.folder / n).exists()), None)
    if bag_path is None:
        sys.exit(f'no data.mcap or data.bag in {args.folder}')
    svo_path = args.folder / 'vid.svo2'
    out_path = args.out or args.folder / 'poses.json'

    print('reading svo2...')
    svo = read_svo(svo_path)
    width, height = read_video_size(svo_path)
    print(f'  {len(svo["frame_ts"])} frames, {width}x{height} side-by-side, SN{svo["serial"]}')

    print('reading bag...')
    bag = read_bag(bag_path)
    odom, llh = bag['odom'], bag['llh']
    print(f'  {len(odom)} ekf samples over {odom[-1, 0] - odom[0, 0]:.0f}s')

    # ros2 bags stamp llh and odom on the same filter tick; older ros1 bags don't
    common, io, il = np.intersect1d(odom[:, 0], llh[:, 0], return_indices=True)
    if len(common) / len(odom) >= 0.99:
        odom, lla = odom[io], llh[il, 1:]
    else:
        print(f'  {len(common)}/{len(odom)} exact stamp matches; interpolating llh onto odom stamps')
        keep = (odom[:, 0] >= llh[0, 0]) & (odom[:, 0] <= llh[-1, 0])
        odom = odom[keep]
        lla = np.stack([np.interp(odom[:, 0], llh[:, 0], llh[:, i]) for i in (1, 2, 3)], 1)

    if args.no_sync:
        offset, corr, overlap = 0.0, None, None
    else:
        print('recovering video->bag clock offset from gyro cross-correlation...')
        offset, corr, overlap = sync_offset(svo['gyro_t'], svo['gyro'], bag['imu'][:, 0], bag['imu'][:, 1])
        print(f'  offset={offset:+.3f}s corr={corr:.3f} overlap={overlap:.0f}s')
        if corr < SYNC_MIN_CORR:
            print(f'warning: weak sync correlation ({corr:.2f} < {SYNC_MIN_CORR}); offset may be wrong')

    vt = svo['frame_ts'] / 1e9 + offset
    covered = float(np.mean((vt >= odom[0, 0]) & (vt <= odom[-1, 0])))
    print(f'  video frames covered by bag poses: {covered:.0%}')

    status = [dict(t=round(t, 3), gnss=g, dual_antenna=d, filter=f, flags=fl)
              for i, (t, g, d, f, fl) in enumerate(bag['status'])
              if i == 0 or bag['status'][i][1:] != bag['status'][i - 1][1:]]

    calib = fetch_calibration(svo['serial'])

    doc = {
        'format': 'robo_v1',
        'camera': {'serial': svo['serial'], 'width_sbs': width, 'height': height,
                   'num_frames': len(svo['frame_ts']),
                   'video_t_start_ns': int(svo['frame_ts'][0]), 'video_t_end_ns': int(svo['frame_ts'][-1]),
                   'factory_calibration_conf': calib, **svo['header']},
        'sync': {'offset_s': round(offset, 4), 'corr': corr, 'overlap_s': overlap,
                 'covered_frame_fraction': round(covered, 4),
                 'method': 'none' if args.no_sync else 'gyro_xcorr'},
        'tf': bag['tf'],
        # camera sits a few cm in front (+x body) of the gnss_2 antenna; tune in the notebook
        'ekf': {
            'frame': 'imu_link', 'quat_convention': 'body_to_ecef_xyzw',
            'alt_datum': 'course_dem', 'alt_offset_from_ellipsoid': ALT_OFFSET,
            't': [round(v, 4) for v in odom[:, 0]],
            'lat': [round(v, 9) for v in lla[:, 0]],
            'lon': [round(v, 9) for v in lla[:, 1]],
            'alt': [round(v + ALT_OFFSET, 4) for v in lla[:, 2]],
            'ecef': np.round(odom[:, 1:4], 4).tolist(),
            'quat': np.round(odom[:, 4:8], 6).tolist(),
            'speed': [round(v, 4) for v in odom[:, 8]],
            'pos_var': np.round(odom[:, 9:12], 6).tolist(),
            'att_var': np.round(odom[:, 12:15], 8).tolist(),
        },
        'gnss2_raw': {
            'alt_datum': 'course_dem', 'alt_offset_from_ellipsoid': ALT_OFFSET,
            't': [round(v, 4) for v in bag['gnss2'][:, 0]],
            'lat': [round(v, 9) for v in bag['gnss2'][:, 1]],
            'lon': [round(v, 9) for v in bag['gnss2'][:, 2]],
            'alt': [round(v + ALT_OFFSET, 4) for v in bag['gnss2'][:, 3]],
            'hvar': [round(v, 6) for v in bag['gnss2'][:, 4]],
            'vvar': [round(v, 6) for v in bag['gnss2'][:, 5]],
        },
        'status_changes': status,
    }
    out_path.write_text(json.dumps(doc))
    print(f'wrote {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
