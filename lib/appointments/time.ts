import type { ScheduleInput } from "@/types/dto/AppointmentRequests";

export function overlaps(start: Date, end: Date, otherStart: Date, otherEnd: Date) {
    return start < otherEnd && end > otherStart;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function localParts(instant: Date, timeZone: string) {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        });
        formatters.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(instant);
    const get = (type: string) => parts.find(p => p.type === type)!.value;
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function insideSchedule(schedule: ScheduleInput | null, start: Date, end: Date, timeZone: string) {
    if (!schedule || start >= end) return false;
    // Inspect every occupied minute so timezone transitions cannot skip a closure.
    for (let time = Math.floor(start.getTime() / 60000) * 60000; time < end.getTime(); time += 60000) {
        const local = localParts(new Date(time), timeZone);
        const exception = schedule.exceptions.find(e => e.date === local.date);
        const windows = exception ? exception.windows : schedule.weekly.filter(w => w.weekday === local.weekday);
        if (!windows.some(w => local.minute >= w.startMinute && local.minute < w.endMinute)) return false;
    }
    return true;
}

export function addMinutes(date: Date, minutes: number) { return new Date(date.getTime() + minutes * 60000); }
