import type { RollDataBase, RollDetails } from "@/lib/roll";

export default function RollHeader({ roll, compact = false }: { roll: RollDetails | RollDataBase, compact?: boolean }) {
    const content = <>
        {roll.driver.name} - {roll.buggy.name} - {' '}
        {roll.roll_date.month}/{roll.roll_date.day}/{roll.roll_date.year}{' '}
        {roll.roll_number && `Roll #${roll.roll_number} `}
        {roll.start_time && (
            <span className={compact ? "text-neutral-500" : "text-base text-neutral-500"}>
                ({new Date(roll.start_time + "Z").toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    hour: '2-digit',
                    minute: '2-digit',
                })})
            </span>
        )}
    </>;

    if (compact) return <span className="text-sm font-medium truncate">{content}</span>;
    return <h1 className="text-2xl">{content}</h1>;
}