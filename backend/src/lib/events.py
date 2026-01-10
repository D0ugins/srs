from db.database import RollEvent
from lib.fit import get_camera_starts, get_gps_data, load_fit_file
from lib.geo import get_elevations

def calculate_hill_times(roll_events: list[RollEvent]) -> dict[int, int | None]:
    """Calculate hill times in ms from roll events."""
    hill1_starts = [e.timestamp_ms for e in roll_events if e.type == 'hill_start' and e.tag == '1']
    hill2_starts = [e.timestamp_ms for e in roll_events if e.type == 'hill_start' and e.tag == '2']
    freeroll_starts = [e.timestamp_ms for e in roll_events if e.type == 'freeroll_start']
    hill3_starts = [e.timestamp_ms for e in roll_events if e.type == 'hill_start' and e.tag == '3']
    hill4_starts = [e.timestamp_ms for e in roll_events if e.type == 'hill_start' and e.tag == '4']
    hill5_starts = [e.timestamp_ms for e in roll_events if e.type == 'hill_start' and e.tag == '5']
    roll_ends = [e.timestamp_ms for e in roll_events if e.type == 'roll_end']
    
    times: dict[int, int | None] = {1: None, 2: None, 3: None, 4: None, 5: None}
    
    if len(hill1_starts) == 1 and len(hill2_starts) == 1:
        times[1] = hill2_starts[0] - hill1_starts[0]
    if len(hill2_starts) == 1 and len(freeroll_starts) == 1:
        times[2] = freeroll_starts[0] - hill2_starts[0]
    if len(hill3_starts) == 1 and len(hill4_starts) == 1:
        times[3] = hill4_starts[0] - hill3_starts[0]
    if len(hill4_starts) == 1 and len(hill5_starts) == 1:
        times[4] = hill5_starts[0] - hill4_starts[0]
    if len(hill5_starts) == 1 and len(roll_ends) == 1:
        times[5] = roll_ends[0] - hill5_starts[0]
    
    return times


def calculate_freeroll_stats(fit_file: str | None, roll_events: list[RollEvent]) -> dict:
    stats: dict = {}
    
    roll_starts = [e.timestamp_ms for e in roll_events if e.type == 'roll_start']
    freeroll_starts = [e.timestamp_ms for e in roll_events if e.type == 'freeroll_start']
    hill3_starts = [e.timestamp_ms for e in roll_events if e.type == 'hill_start' and e.tag == '3']
    roll_ends = [e.timestamp_ms for e in roll_events if e.type == 'roll_end']
    
    if len(freeroll_starts) == 1 and len(hill3_starts) == 1:
        stats['freeroll_time_ms'] = hill3_starts[0] - freeroll_starts[0]
    
    if fit_file is None: return stats
    
    try:
        messages = load_fit_file(fit_file)
        camera_starts = get_camera_starts(messages)
        
        if len(camera_starts) != 1: return stats
        
        if len(roll_starts) == 1:
            stats['video_roll_start_ms'] = roll_starts[0] - camera_starts[0]
        if len(roll_ends) == 1:
            stats['video_roll_end_ms'] = roll_ends[0] - camera_starts[0]
        
        gps_data = get_gps_data(messages)
        if gps_data is None: return stats
        
        stats['max_speed'] = float(gps_data['speed'].max())
        elevations = get_elevations(gps_data, snap_to_course=True, subtract_start_line=True)
        energy = gps_data.speed ** 2 / 2 + elevations * 9.81
        stats['max_energy'] = float(energy.max())
        if len(hill3_starts) == 1:
            stats['freeroll_energy_loss'] = float(energy.max() - energy.loc[hill3_starts[0]])
        if len(freeroll_starts) == 1 and len(hill3_starts) == 1:
            pickup_timestamp = energy.loc[freeroll_starts[0]:hill3_starts[0] + 10_000].idxmin()
            stats['pickup_energy'] = float(energy.loc[pickup_timestamp])
            stats['pickup_speed'] = float(gps_data.speed.loc[pickup_timestamp])
            stats['rollup_height'] = float(elevations.loc[hill3_starts[0]] - elevations.loc[pickup_timestamp])
    except Exception as e:
        print(f"Error loading fit data: {e}")
    
    return stats
