from db.database import RollEvent

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


def calculate_freeroll_stats(graphs: dict, roll_events: list[RollEvent]) -> dict:
    stats: dict = {}
    
    roll_starts = [e.timestamp_ms for e in roll_events if e.type == 'roll_start']
    freeroll_starts = [e.timestamp_ms for e in roll_events if e.type == 'freeroll_start']
    chute_starts = [e.timestamp_ms for e in roll_events if e.type == 'chute_start']
    hill3_starts = [e.timestamp_ms for e in roll_events if e.type == 'hill_start' and e.tag == '3']
    roll_ends = [e.timestamp_ms for e in roll_events if e.type == 'roll_end']
    
    if len(freeroll_starts) == 1 and len(hill3_starts) == 1:
        stats['freeroll_time_ms'] = hill3_starts[0] - freeroll_starts[0]
    
    if 'gps_data' not in graphs: return stats
    
    try:
        video_start = graphs.get('video_start')
        
        if video_start is not None:
            if len(roll_starts) == 1:
                stats['video_roll_start_ms'] = roll_starts[0] - video_start
            if len(roll_ends) == 1:
                stats['video_roll_end_ms'] = roll_ends[0] - video_start
        
        gps_data = graphs['gps_data']
        if gps_data is None or gps_data.empty: return stats
        
        gps_data.index = gps_data['timestamp']

        stats['max_speed'] = float(gps_data['speed'].max())
        elevations = gps_data['elevation']
        energy = gps_data['speed'] ** 2 / 2 + elevations * 9.81
        stats['max_energy'] = float(energy.max())
        
        # snap hill starts to gps_timestamps
        hill3_starts = list(gps_data['timestamp'].iloc[gps_data.index.get_indexer(hill3_starts, method='nearest')]) # type: ignore
        freeroll_starts = list(gps_data['timestamp'].iloc[gps_data.index.get_indexer(freeroll_starts, method='nearest')]) # type: ignore
        if len(hill3_starts) == 1:
            if len(chute_starts) == 1:
                chute_start = gps_data['timestamp'].iloc[gps_data.index.get_indexer(chute_starts, method='nearest')[0]] # type: ignore
                stats['to_chute_energy_loss'] = float(energy.max() - energy.loc[chute_start])
                stats['chute_energy_loss'] = float(energy.loc[chute_start] - energy.loc[hill3_starts[0]])
            stats['freeroll_energy_loss'] = float(energy.max() - energy.loc[hill3_starts[0]])
        if len(freeroll_starts) == 1 and len(hill3_starts) == 1:
            pickup_timestamp = energy.loc[freeroll_starts[0]:hill3_starts[0] + 10_000].idxmin()
            stats['pickup_timestamp_ms'] = int(pickup_timestamp)
            stats['pickup_energy'] = float(energy.loc[pickup_timestamp])
            stats['pickup_speed'] = float(gps_data['speed'].loc[pickup_timestamp])
            stats['rollup_height'] = float(elevations.loc[hill3_starts[0]] - elevations.loc[pickup_timestamp])
    except Exception as e:
        print(f"Error loading graph data: {e}")
    
    return stats
