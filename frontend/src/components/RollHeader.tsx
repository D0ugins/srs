import type { RollDataBase, RollDetails } from "@/lib/roll";

export default function RollHeader({ roll }: { roll: RollDetails | RollDataBase }) {
    return <h1 className="text-2xl">
        {roll.driver.name} - {roll.buggy.name} - {' '}
        {roll.roll_date.month}/{roll.roll_date.day}/{roll.roll_date.year}{' '}
        {roll.roll_number && `Roll #${roll.roll_number} `}
        {roll.start_time && (
            <span className="text-base text-gray-500">
                ({new Date(roll.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
            </span>
        )}
    </h1>
}