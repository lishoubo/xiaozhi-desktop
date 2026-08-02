import type { CalendarEventRecord } from '../../shared/calendar';

const CALENDAR_ID = 'china-mainland-holidays';
const LOCAL_MIDNIGHT = 'T00:00:00.000';

/*
 * The 2026 ranges reproduce the State Council's published adjusted schedule.
 * Later years contain only the statutory dates whose calendar position is knowable
 * in advance; annual weekend swaps are deliberately not predicted before publication.
 */

type FestivalDates = Readonly<{
  springFestival: string;
  qingming: string;
  dragonBoat: string;
  midAutumn: string;
}>;

const FESTIVAL_DATES: Readonly<Record<number, FestivalDates>> = {
  2027: {
    springFestival: '2027-02-07',
    qingming: '2027-04-05',
    dragonBoat: '2027-06-09',
    midAutumn: '2027-09-15',
  },
  2028: {
    springFestival: '2028-01-26',
    qingming: '2028-04-04',
    dragonBoat: '2028-05-28',
    midAutumn: '2028-10-03',
  },
  2029: {
    springFestival: '2029-02-13',
    qingming: '2029-04-04',
    dragonBoat: '2029-06-16',
    midAutumn: '2029-09-22',
  },
  2030: {
    springFestival: '2030-02-02',
    qingming: '2030-04-05',
    dragonBoat: '2030-06-05',
    midAutumn: '2030-09-12',
  },
  2031: {
    springFestival: '2031-01-23',
    qingming: '2031-04-05',
    dragonBoat: '2031-06-24',
    midAutumn: '2031-10-01',
  },
  2032: {
    springFestival: '2032-02-11',
    qingming: '2032-04-04',
    dragonBoat: '2032-06-12',
    midAutumn: '2032-09-19',
  },
  2033: {
    springFestival: '2033-01-31',
    qingming: '2033-04-04',
    dragonBoat: '2033-06-01',
    midAutumn: '2033-09-08',
  },
  2034: {
    springFestival: '2034-02-19',
    qingming: '2034-04-05',
    dragonBoat: '2034-06-20',
    midAutumn: '2034-09-27',
  },
  2035: {
    springFestival: '2035-02-08',
    qingming: '2035-04-05',
    dragonBoat: '2035-06-10',
    midAutumn: '2035-09-16',
  },
  2036: {
    springFestival: '2036-01-28',
    qingming: '2036-04-04',
    dragonBoat: '2036-05-30',
    midAutumn: '2036-10-04',
  },
};

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function event(
  year: number,
  slug: string,
  title: string,
  start: string,
  end: string,
): CalendarEventRecord {
  return {
    id: `cn-holiday-${year}-${slug}`,
    calendarId: CALENDAR_ID,
    title,
    startsAt: `${start}${LOCAL_MIDNIGHT}`,
    endsAt: `${end}${LOCAL_MIDNIGHT}`,
    allDay: true,
    notes: '',
    source: 'holiday-seed',
  };
}

function published2026Events(): CalendarEventRecord[] {
  return [
    event(2026, 'new-year', '元旦', '2026-01-01', '2026-01-04'),
    event(2026, 'spring-festival', '春节', '2026-02-15', '2026-02-24'),
    event(2026, 'qingming', '清明节', '2026-04-04', '2026-04-07'),
    event(2026, 'labour-day', '劳动节', '2026-05-01', '2026-05-06'),
    event(2026, 'dragon-boat', '端午节', '2026-06-19', '2026-06-22'),
    event(2026, 'mid-autumn', '中秋节', '2026-09-25', '2026-09-28'),
    event(2026, 'national-day', '国庆节', '2026-10-01', '2026-10-08'),
  ];
}

function statutoryEvents(year: number, dates: FestivalDates): CalendarEventRecord[] {
  return [
    event(year, 'new-year', '元旦', `${year}-01-01`, `${year}-01-02`),
    event(
      year,
      'spring-festival',
      '春节',
      addDays(dates.springFestival, -1),
      addDays(dates.springFestival, 3),
    ),
    event(year, 'qingming', '清明节', dates.qingming, addDays(dates.qingming, 1)),
    event(year, 'labour-day', '劳动节', `${year}-05-01`, `${year}-05-03`),
    event(year, 'dragon-boat', '端午节', dates.dragonBoat, addDays(dates.dragonBoat, 1)),
    event(year, 'mid-autumn', '中秋节', dates.midAutumn, addDays(dates.midAutumn, 1)),
    event(year, 'national-day', '国庆节', `${year}-10-01`, `${year}-10-04`),
  ];
}

export function chinaMainlandHolidaySeed(): CalendarEventRecord[] {
  return [
    ...published2026Events(),
    ...Object.entries(FESTIVAL_DATES).flatMap(([year, dates]) =>
      statutoryEvents(Number(year), dates),
    ),
  ];
}
