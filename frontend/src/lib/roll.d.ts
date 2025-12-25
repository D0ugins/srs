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

    roll_files: {
        id: number;
        uri: string;
        sensor_id: number;
        type: string;

        created_at: string;
        updated_at: string;
    }[];

    driver_notes: string;
    mech_notes: string;
    pusher_notes: string;

    created_at: string;
    updated_at: string;
}

export interface RollDetails extends RollDataBase {
    roll_files: {
        id: number;
        uri: string;
        sensor: {
            id: number;
            name: string;
            abbreviation: string;
            uri?: string;
            type: string;

            created_at: string;
            updated_at: string;
        };
        type: string;

        created_at: string;
        updated_at: string;
    }[];

    roll_events: {
        id: number;
        event_type: string;
        timestamp: string;
        description: string;

        created_at: string;
        updated_at: string;
    }[];

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