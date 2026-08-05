import type { Spec } from '@json-render/core';

export type HotelPreviewId =
  | 'operations'
  | 'exceptions'
  | 'rooms'
  | 'arrivals'
  | 'rates'
  | 'channels'
  | 'guests'
  | 'finance'
  | 'reviews'
  | 'revenue';

export type HotelPreview = {
  id: HotelPreviewId;
  label: string;
  description: string;
  spec: Spec;
};

type Element = Spec['elements'][string];

function element(type: string, props: Record<string, unknown>, children: string[] = []): Element {
  return { type, props, children, visible: true };
}

function previewSpec(
  title: string,
  description: string,
  content: Record<string, Element>,
  children: string[],
): Spec {
  return {
    root: 'root',
    state: {},
    elements: {
      root: element(
        'Stack',
        {
          direction: 'vertical',
          gap: 'md',
          align: 'stretch',
          justify: 'start',
        },
        ['preview-heading', 'preview-meta', ...children],
      ),
      'preview-heading': element('Heading', { text: title, level: 'h2' }),
      'preview-meta': element(
        'Stack',
        {
          direction: 'horizontal',
          gap: 'sm',
          align: 'center',
          justify: 'start',
        },
        ['mock-badge', 'preview-description'],
      ),
      'mock-badge': element('Badge', { text: 'Mock 数据', variant: 'secondary' }),
      'preview-description': element('Text', { text: description, variant: 'muted' }),
      ...content,
    },
  };
}

export const hotelGenerativeUiPreviews: HotelPreview[] = [
  {
    id: 'operations',
    label: '今日运营',
    description: '入住、房态与待办摘要',
    spec: previewSpec(
      '今日运营简报',
      '上海静安店 · 2026 年 8 月 1 日',
      {
        metrics: element('Grid', { columns: 3, gap: 'md' }, ['occupancy', 'arrivals', 'tasks']),
        occupancy: element(
          'Card',
          {
            title: '入住率 78%',
            description: '可售 86 间 · 已售 67 间',
            maxWidth: 'full',
            centered: false,
          },
          ['occupancy-progress'],
        ),
        'occupancy-progress': element('Progress', { value: 78, max: 100, label: '今日入住率' }),
        arrivals: element('Card', {
          title: '预计到店 42 间',
          description: '已办理 18 间',
          maxWidth: 'full',
          centered: false,
        }),
        tasks: element('Card', {
          title: '优先待办 5 项',
          description: '其中 2 项将在 30 分钟内超时',
          maxWidth: 'full',
          centered: false,
        }),
        alert: element('Alert', {
          title: '先处理 2 笔待确认订单',
          message: '最近一笔将在 28 分钟后超时。',
          type: 'warning',
        }),
      },
      ['metrics', 'alert'],
    ),
  },
  {
    id: 'exceptions',
    label: '异常订单',
    description: '超时、缺失与冲突订单',
    spec: previewSpec(
      '异常订单处理',
      '按风险和剩余处理时间排序',
      {
        alert: element('Alert', {
          title: '2 笔订单需要优先确认',
          message: '最近一笔将在 28 分钟后超时。',
          type: 'warning',
        }),
        status: element('Badge', { text: '即将超时', variant: 'destructive' }),
        table: element('Table', {
          columns: ['状态', '订单号', '渠道', '房型', '入住日', '问题'],
          rows: [
            ['即将超时', 'HB202608010023', '携程', '豪华大床房', '8 月 1 日', '待确认'],
            ['信息缺失', 'HB202608010019', '美团', '高级双床房', '8 月 2 日', '未留到店时间'],
            ['价格冲突', 'HB202608010011', '飞猪', '商务大床房', '8 月 3 日', '订单价低于底价'],
          ],
          caption: '示例订单已隐去宾客个人信息',
        }),
      },
      ['alert', 'status', 'table'],
    ),
  },
  {
    id: 'rooms',
    label: '房态库存',
    description: '房型、清扫与渠道库存',
    spec: previewSpec(
      '房态与库存',
      '今日剩余房量及清扫进度',
      {
        progress: element('Progress', { value: 24, max: 31, label: '已完成清扫 24 / 31 间' }),
        table: element('Table', {
          columns: ['房型', '可售', '已售', '脏房', '维修', '携程库存', '美团库存'],
          rows: [
            ['豪华大床房', '6', '18', '3', '0', '4', '4'],
            ['高级双床房', '2', '15', '4', '1', '2', '1'],
            ['行政套房', '1', '5', '0', '0', '1', '1'],
          ],
          caption: '库存更新时间 14:20',
        }),
        alert: element('Alert', {
          title: '高级双床房库存偏紧',
          message: '可售 2 间，仍有 4 间待清扫。',
          type: 'info',
        }),
      },
      ['progress', 'table', 'alert'],
    ),
  },
  {
    id: 'arrivals',
    label: '到离店',
    description: '今日到店与离店安排',
    spec: previewSpec(
      '今日到店与离店',
      '前台交接视图 · 按预计时间排序',
      {
        tabs: element(
          'Tabs',
          {
            tabs: [
              { label: '到店 42', value: 'arrival' },
              { label: '离店 36', value: 'departure' },
            ],
            defaultValue: 'arrival',
            value: 'arrival',
          },
          ['table'],
        ),
        table: element('Table', {
          columns: ['预计时间', '订单', '房型', '间数', '状态', '备注'],
          rows: [
            ['15:00', 'HB…0023', '豪华大床房', '1', '待确认', '晚到店'],
            ['16:30', 'HB…0027', '高级双床房', '2', '已确认', '连通房偏好'],
            ['18:00', 'HB…0031', '行政套房', '1', '已确认', '会员礼遇'],
          ],
          caption: null,
        }),
      },
      ['tabs'],
    ),
  },
  {
    id: 'rates',
    label: '价格对比',
    description: '渠道价与直销价差异',
    spec: previewSpec(
      '渠道价格对比',
      '未来 3 天 · 含税可订价格',
      {
        alert: element('Alert', {
          title: '发现 1 项倒挂',
          message: '8 月 2 日豪华大床房的携程价低于直销价 30 元。',
          type: 'warning',
        }),
        table: element('Table', {
          columns: ['日期', '房型', '直销', '携程', '美团', '飞猪', '最低价差'],
          rows: [
            ['8 月 1 日', '豪华大床房', '¥688', '¥688', '¥698', '¥688', '¥0'],
            ['8 月 2 日', '豪华大床房', '¥718', '¥688', '¥718', '¥708', '-¥30'],
            ['8 月 3 日', '高级双床房', '¥628', '¥628', '¥638', '¥628', '¥0'],
          ],
          caption: '价格仅用于静态预览',
        }),
      },
      ['alert', 'table'],
    ),
  },
  {
    id: 'channels',
    label: '渠道经营',
    description: '产量、收入与渠道健康',
    spec: previewSpec(
      '渠道经营表现',
      '本月截至 8 月 1 日',
      {
        grid: element('Grid', { columns: 3, gap: 'md' }, ['ctrip', 'meituan', 'fliggy']),
        ctrip: element(
          'Card',
          {
            title: '携程',
            description: '订单 126 · 间夜 184 · ¥112,680',
            maxWidth: 'full',
            centered: false,
          },
          ['ctrip-progress'],
        ),
        'ctrip-progress': element('Progress', { value: 61, max: 100, label: '渠道间夜占比 61%' }),
        meituan: element('Card', {
          title: '美团',
          description: '订单 52 · 间夜 73 · ¥39,420',
          maxWidth: 'full',
          centered: false,
        }),
        fliggy: element('Card', {
          title: '飞猪',
          description: '订单 31 · 间夜 44 · ¥25,960',
          maxWidth: 'full',
          centered: false,
        }),
        alert: element('Alert', {
          title: '渠道连接正常',
          message: '最近一次库存同步于 14:20 完成。',
          type: 'success',
        }),
      },
      ['grid', 'alert'],
    ),
  },
  {
    id: 'guests',
    label: '宾客服务',
    description: '偏好、请求与服务跟进',
    spec: previewSpec(
      '宾客服务跟进',
      '仅展示完成服务所需的信息',
      {
        card: element(
          'Card',
          {
            title: '行政套房 · 1808',
            description: '金卡会员 · 今日 18:00 前到店',
            maxWidth: 'full',
            centered: false,
          },
          ['badges', 'requests'],
        ),
        badges: element(
          'Stack',
          { direction: 'horizontal', gap: 'sm', align: 'center', justify: 'start' },
          ['quiet', 'late'],
        ),
        quiet: element('Badge', { text: '偏好安静房', variant: 'secondary' }),
        late: element('Badge', { text: '晚到店', variant: 'outline' }),
        requests: element('Table', {
          columns: ['服务事项', '责任部门', '期望完成', '状态'],
          rows: [
            ['婴儿床', '客房部', '17:00', '处理中'],
            ['欢迎水果', '前厅', '入住前', '已安排'],
          ],
          caption: null,
        }),
      },
      ['card'],
    ),
  },
  {
    id: 'finance',
    label: '财务对账',
    description: '渠道账款与差异定位',
    spec: previewSpec(
      '渠道对账摘要',
      '结算周期：2026 年 7 月',
      {
        grid: element('Grid', { columns: 3, gap: 'md' }, ['receivable', 'received', 'difference']),
        receivable: element('Card', {
          title: '应收 ¥286,420',
          description: '312 笔订单',
          maxWidth: 'full',
          centered: false,
        }),
        received: element('Card', {
          title: '已收 ¥281,960',
          description: '到账率 98.4%',
          maxWidth: 'full',
          centered: false,
        }),
        difference: element('Card', {
          title: '差异 ¥4,460',
          description: '7 笔待核对',
          maxWidth: 'full',
          centered: false,
        }),
        table: element('Table', {
          columns: ['渠道', '订单数', '应收', '已收', '差异', '状态'],
          rows: [
            ['携程', '186', '¥182,600', '¥180,140', '¥2,460', '待核对'],
            ['美团', '79', '¥61,320', '¥60,320', '¥1,000', '待核对'],
            ['飞猪', '47', '¥42,500', '¥41,500', '¥1,000', '待核对'],
          ],
          caption: null,
        }),
      },
      ['grid', 'table'],
    ),
  },
  {
    id: 'reviews',
    label: '点评口碑',
    description: '评分趋势与待回复点评',
    spec: previewSpec(
      '点评与口碑',
      '近 30 天 · 三方渠道汇总',
      {
        grid: element('Grid', { columns: 3, gap: 'md' }, ['score', 'positive', 'pending']),
        score: element('Card', {
          title: '综合评分 4.72',
          description: '较上期 +0.08',
          maxWidth: 'full',
          centered: false,
        }),
        positive: element('Card', {
          title: '好评率 96%',
          description: '共 128 条点评',
          maxWidth: 'full',
          centered: false,
        }),
        pending: element('Card', {
          title: '待回复 3 条',
          description: '其中低分点评 1 条',
          maxWidth: 'full',
          centered: false,
        }),
        alert: element('Alert', {
          title: '优先回复入住等待反馈',
          message: '该点评评分 2.0，发布于今天 11:32。',
          type: 'warning',
        }),
        topics: element('Table', {
          columns: ['高频主题', '提及次数', '情绪'],
          rows: [
            ['位置便利', '48', '正向'],
            ['房间整洁', '41', '正向'],
            ['入住等待', '12', '需改善'],
          ],
          caption: null,
        }),
      },
      ['grid', 'alert', 'topics'],
    ),
  },
  {
    id: 'revenue',
    label: '收益预测',
    description: '需求、价格与收入建议',
    spec: previewSpec(
      '未来 7 天收益预测',
      '基于当前预订与示例需求曲线',
      {
        grid: element('Grid', { columns: 3, gap: 'md' }, ['occupancy', 'adr', 'revpar']),
        occupancy: element('Card', {
          title: '预测入住率 84%',
          description: '较去年同期 +6 个百分点',
          maxWidth: 'full',
          centered: false,
        }),
        adr: element('Card', {
          title: '平均房价 ¥672',
          description: '较当前在售价 +¥24',
          maxWidth: 'full',
          centered: false,
        }),
        revpar: element('Card', {
          title: 'RevPAR ¥564',
          description: '较去年同期 +11%',
          maxWidth: 'full',
          centered: false,
        }),
        table: element('Table', {
          columns: ['日期', '预测入住率', '当前均价', '建议均价', '建议'],
          rows: [
            ['8 月 2 日', '91%', '¥688', '¥728', '上调'],
            ['8 月 3 日', '86%', '¥668', '¥698', '小幅上调'],
            ['8 月 4 日', '64%', '¥628', '¥608', '开放促销'],
          ],
          caption: '收益建议仅用于静态预览',
        }),
        alert: element('Alert', {
          title: '周六需求较高',
          message: '保留 3 间机动库存，暂不开放低价促销。',
          type: 'info',
        }),
      },
      ['grid', 'table', 'alert'],
    ),
  },
];

export function findHotelPreview(id: HotelPreviewId): HotelPreview {
  const preview = hotelGenerativeUiPreviews.find((item) => item.id === id);
  if (!preview) throw new Error(`Unknown hotel generative UI preview: ${id}`);
  return preview;
}
