import type { CalendarEventCreateInput } from '../../shared/calendar';

export const HOTEL_OPERATIONS_MOCK_GROUP = {
  id: 'mock-hotel-operations',
  label: '酒店运营示例',
  color: '#2a9d99',
  isSystem: true,
} as const;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateTime(reference: Date, dayOffset: number, hour: number, minute = 0): string {
  const value = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + dayOffset,
    hour,
    minute,
  );
  return `${value.getFullYear()}-${twoDigits(value.getMonth() + 1)}-${twoDigits(value.getDate())}T${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}:00.000`;
}

function timedEvent(
  id: string,
  title: string,
  reference: Date,
  dayOffset: number,
  startHour: number,
  endHour: number,
  notes: string,
): CalendarEventCreateInput {
  return {
    id: `mock-hotel-ops-${id}`,
    calendarId: HOTEL_OPERATIONS_MOCK_GROUP.id,
    title,
    startsAt: localDateTime(reference, dayOffset, startHour),
    endsAt: localDateTime(reference, dayOffset, endHour),
    allDay: false,
    notes,
  };
}

function allDayEvent(
  id: string,
  title: string,
  reference: Date,
  dayOffset: number,
  notes: string,
): CalendarEventCreateInput {
  return {
    id: `mock-hotel-ops-${id}`,
    calendarId: HOTEL_OPERATIONS_MOCK_GROUP.id,
    title,
    startsAt: localDateTime(reference, dayOffset, 0),
    endsAt: localDateTime(reference, dayOffset + 1, 0),
    allDay: true,
    notes,
  };
}

export function hotelOperationsMockEvents(
  reference: Date = new Date(),
): CalendarEventCreateInput[] {
  return [
    timedEvent(
      'daily-briefing',
      '每日运营晨会',
      reference,
      0,
      9,
      10,
      '复盘昨日入住率、平均房价、RevPAR、差评与当日重点接待。',
    ),
    timedEvent(
      'inventory-check',
      '渠道库存与房态核对',
      reference,
      0,
      15,
      16,
      '核对 PMS 与各 OTA 可售库存、关房状态和超售风险。',
    ),
    timedEvent(
      'revenue-strategy',
      '未来 14 天收益策略调整',
      reference,
      1,
      10,
      11,
      '结合预订进度、竞品房价和城市活动调整价格及房型配额。',
    ),
    allDayEvent(
      'ota-campaign-deadline',
      'OTA 促销活动报名截止',
      reference,
      2,
      '确认活动折扣、可售日期、库存上限及价格一致性。',
    ),
    timedEvent(
      'vip-arrival-prep',
      'VIP 与团队入住准备会',
      reference,
      3,
      14,
      15,
      '确认排房、欢迎礼、早餐安排、特殊需求与到店时间。',
    ),
    timedEvent(
      'room-maintenance',
      '客房空调与设施巡检',
      reference,
      4,
      9,
      12,
      '工程部与客房部联合检查高频报修房间并更新停用房计划。',
    ),
    timedEvent(
      'reputation-review',
      '宾客评价与服务改进复盘',
      reference,
      6,
      16,
      17,
      '汇总 OTA 评分、差评原因和待跟进服务问题。',
    ),
    timedEvent(
      'monthly-business-review',
      '月度经营分析会',
      reference,
      8,
      10,
      12,
      '复盘收入、成本、渠道结构、会员贡献和下月经营目标。',
    ),
  ];
}
