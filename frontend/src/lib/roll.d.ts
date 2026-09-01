import type { EventType } from "@/lib/constants";

export interface Driver {
    id: number;
    name: string;

    created_at: string;
    updated_at: string;
}

export interface Buggy {
    id: number;
    name: string;
    abbreviation: string;

    created_at: string;
    updated_at: string;
}

export type Gender = "M" | "F" | "AG";

export interface Pusher {
    id: number;
    name: string;
    gender?: Gender;

    created_at: string;
    updated_at: string;
}

export interface Sensor {
    id: number;
    name: string;
    type: string;
    abbreviation: string;
    uri?: string;

    created_at: string;
    updated_at: string;
}

export interface RollFile {
    id: number;
    uri: string;
    type: string;
    start_utc: string | null;
    local_start_ms: number | null;
    local_end_ms: number | null;

    created_at: string;
    updated_at: string;
}

export interface RollDataBase {
    id: number;
    roll_number?: number;
    start_time?: string;

    driver: Driver
    buggy: Buggy;

    roll_date: {
        id: number;
        year: number;
        month: number;
        day: number;

        temperature?: number;
        humidity?: number;
        type: "weekend" | "midnight" | "raceday";

        notes: string;
    };

    roll_files: RollFile[];

    driver_notes: string;
    mech_notes: string;
    pusher_notes: string;

    created_at: string;
    updated_at: string;
}

export interface RollDetails extends RollDataBase {
    roll_files: (RollFile & {
        sensor: {
            id: number;
            name: string;
            abbreviation: string;
            uri?: string;
            type: string;

            created_at: string;
            updated_at: string;
        };
    })[];

    roll_events: RollEvent[];

    roll_hills: {
        id: number;
        hill_number: number;
        pusher: {
            id: number;
            name: string;

            created_at: string;
            updated_at: string;
        } | null;

        created_at: string;
        updated_at: string;
    }[];
}

export interface RollDateInput {
    year: number;
    month: number;
    day: number;
    temperature?: number;
    humidity?: number;
    type: "weekend" | "midnight" | "raceday";
}

export interface RollFileInput {
    type: string;
    uri: string;
    sensor_abbreviation?: string;
}

export interface RollHillInput {
    hill_number: number;
    pusher_name: string;
}

export interface RollUpdate {
    driver_notes: string;
    mech_notes: string;
    pusher_notes: string;

    roll_number?: number;
    start_time?: string;

    buggy_abbreviation: string;
    driver_name: string;

    roll_date: RollDateInput;
    roll_files: RollFileInput[];
    roll_hills: RollHillInput[];
}

export interface RollGraphData {
    video_start: number;
    video_end: number;
    gps_data?: {
        timestamp: number[];
        lat: number[];
        long: number[];
        elevation: number[];
        speed: number[];
        energy?: number[];
        sd_speed?: number[];
        sd_elevation?: number[];
        sd_energy?: number[];
        sd_x?: number[];
        sd_y?: number[];
        // Currently 1Hz bandwidth
        a_fwd?: number[];
        a_lat?: number[];
        sd_a_fwd?: number[];
        sd_a_lat?: number[];
        a_drag?: number[];        // a_fwd with the DEM's local gravity component removed
        sd_a_drag?: number[];
    }
    gps_source?: 'trace' | 'racebox' | 'fit' | 'gpx';
    centripetal?: {
        timestamp: number[];
        values: number[];
    }
    accelerometer?: {
        timestamp: number[];
        x: number[];
        y: number[];
        z: number[];
    }
    gyroscope?: {
        timestamp: number[];
        x: number[];
        y: number[];
        z: number[];
    }
    magnetometer?: {
        timestamp: number[];
        x: number[];
        y: number[];
        z: number[];
    }
}

export interface RollEvent {
    id?: number;
    type: EventType;
    tag?: string;
    timestamp_ms: number;
    raw_timestamp?: string;

    created_at?: string;
    updated_at?: string;
}

export type StatStatus = "ok" | "outside_trace" | "in_gap" | "failed";

export interface StatQuantity {
    value: number | null;
    sd: number | null;
    unit: string;
    status: StatStatus;
    note: string | null;
}

export type StatKey =
    | "time.hill_1-hill_2"
    | "time.hill_2-crosswalk"
    | "time.hill_3-hill_4"
    | "time.hill_4-hill_5"
    | "time.hill_5-finish_line"
    | "time.crosswalk-hill_3"
    | "time.crosswalk-stop_sign"
    | "time.stop_sign-hill_3"
    | "time.crosswalk-chute_start"
    | "time.chute_start-hill_3"
    | "time.hill_1-finish_line"
    | "speed.crosswalk"
    | "energy.crosswalk"
    | "speed.chute_start"
    | "energy.chute_start"
    | "eloss.crosswalk-hill_3"
    | "eloss.crosswalk-chute_start"
    | "eloss.chute_start-hill_3"
    | "path.crosswalk-hill_3"
    | "path.crosswalk-chute_start"
    | "path.chute_start-hill_3"
    | "pickup.arc"
    | "pickup.speed"
    | "max_speed"
    | "max_energy";

export interface RollStats {
    source: string;
    quantities?: Partial<Record<StatKey, StatQuantity>>;

    video_roll_start_ms?: number;
    video_roll_end_ms?: number;
}
