import type { RollDataBase, RollDetails } from "@/lib/roll";

export default function RollHeader({ roll, compact = false }: { roll: RollDetails | RollDataBase, compact?: boolean }) {
    const seperator = compact ? ' ' : ' - ';
    const content = <>
        {compact ? roll.driver.name.toLowerCase() : roll.driver.name}{seperator}{compact ? roll.buggy.abbreviation : roll.buggy.name}{seperator}
        {roll.roll_date.month}/{roll.roll_date.day}/{roll.roll_date.year}{' '}
        {roll.roll_number && `${compact ? '' : 'Roll '}#${roll.roll_number} `}
        {roll.start_time && (
            <span className={compact ? "text-neutral-500 text-xs" : "text-base text-neutral-500"}>
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