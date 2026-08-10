import { defineCatalog } from '@json-render/core';
// The legacy CommonJS ESLint resolver cannot resolve this workspace package's export map.
/* eslint-disable import/no-unresolved */
import {
  hotelDistributionChartPropsSchema,
  hotelRadarChartPropsSchema,
  hotelRadialChartPropsSchema,
  hotelTrendChartPropsSchema,
} from '@hotel-butler/api/contracts';
/* eslint-enable import/no-unresolved */
// The legacy CommonJS ESLint resolver cannot inspect this package's ESM export map.
// eslint-disable-next-line import/no-unresolved
import { shadcnComponentDefinitions } from '@json-render/shadcn-svelte/catalog';
// eslint-disable-next-line import/no-unresolved
import { schema } from '@json-render/svelte/schema';

type ShadcnComponentName = keyof typeof shadcnComponentDefinitions;

function hotelComponent<Name extends ShadcnComponentName>(name: Name, guidance: string) {
  const definition = shadcnComponentDefinitions[name];
  return {
    ...definition,
    description: `${definition.description} 酒店业务用法：${guidance}`,
  };
}

export const hotelComponentDefinitions = {
  Card: hotelComponent('Card', '承载一个明确任务区域，例如订单详情、经营摘要或宾客档案。'),
  Stack: hotelComponent('Stack', '排列同一任务中的信息与操作，避免无意义的卡片嵌套。'),
  Grid: hotelComponent('Grid', '仅在需要并排比较房型、渠道或指标时使用。'),
  Separator: hotelComponent('Separator', '分隔订单、费用、政策等语义区块。'),
  Tabs: hotelComponent('Tabs', '切换同一对象的概览、明细或时间范围。'),
  Accordion: hotelComponent('Accordion', '折叠展示取消政策、价格规则和异常原因等次要详情。'),
  Collapsible: hotelComponent('Collapsible', '渐进披露执行记录、数据来源或诊断信息。'),
  Dialog: hotelComponent('Dialog', '确认会打断当前任务的编辑或高风险操作。'),
  Drawer: hotelComponent('Drawer', '在不离开对话的情况下查看订单或宾客详情。'),
  Carousel: hotelComponent('Carousel', '浏览少量房型图片或方案；数据比较优先使用表格。'),
  Table: hotelComponent('Table', '展示订单、房态、库存、渠道价格、账务和工单等可扫描数据。'),
  Heading: hotelComponent('Heading', '给生成结果或关键任务区域提供简短标题。'),
  Text: hotelComponent('Text', '说明结论、时间口径、变化原因或下一步建议。'),
  Image: hotelComponent('Image', '展示房型、设施或问题现场图片，必须提供准确替代文本。'),
  Avatar: hotelComponent('Avatar', '表示宾客、员工或渠道联系人，不暴露非必要个人信息。'),
  Badge: hotelComponent('Badge', '标记订单、房态、支付、渠道或工单状态，不只依赖颜色。'),
  Alert: hotelComponent('Alert', '突出超时、超售、关房、支付或服务恢复事项。'),
  Progress: hotelComponent('Progress', '表达入住办理、清扫、任务或目标完成度。'),
  HotelAreaChart: {
    props: hotelTrendChartPropsSchema,
    description: '酒店趋势面积图。用于入住率、需求、收入或天气随时间的连续变化；最多 31 个点。',
    example: {
      title: '未来 7 天入住率',
      data: [
        { label: '周一', value: 68, comparison: 64 },
        { label: '周二', value: 76, comparison: 69 },
      ],
      valueLabel: '本期',
      comparisonLabel: '同期',
      unit: '%',
    },
  },
  HotelLineChart: {
    props: hotelTrendChartPropsSchema,
    description: '酒店双序列折线图。用于价格、评分、温度、RevPAR 等精确趋势比较。',
    example: {
      title: '渠道价格趋势',
      data: [
        { label: '8/1', value: 688, comparison: 698 },
        { label: '8/2', value: 718, comparison: 688 },
      ],
      valueLabel: '直销价',
      comparisonLabel: '渠道价',
      unit: '元',
    },
  },
  HotelBarChart: {
    props: hotelTrendChartPropsSchema,
    description: '酒店分组柱状图。用于渠道、房型、部门或日期之间的离散数值比较。',
    example: {
      title: '渠道间夜对比',
      data: [
        { label: '携程', value: 184, comparison: 172 },
        { label: '美团', value: 73, comparison: 68 },
      ],
      valueLabel: '本月',
      comparisonLabel: '上月',
      unit: '间夜',
    },
  },
  HotelDonutChart: {
    props: hotelDistributionChartPropsSchema,
    description: '酒店占比环图。仅用于 2–5 个渠道、房态、客源或费用类别的构成。',
    example: {
      title: '渠道间夜构成',
      items: [
        { label: '携程', value: 184 },
        { label: '美团', value: 73 },
        { label: '飞猪', value: 44 },
      ],
      unit: '间夜',
    },
  },
  HotelRadarChart: {
    props: hotelRadarChartPropsSchema,
    description: '酒店多维雷达图。用于服务质量、部门表现或竞品维度比较；必须统一量纲。',
    example: {
      title: '服务质量维度',
      items: [
        { label: '清洁', value: 92, benchmark: 88 },
        { label: '响应', value: 84, benchmark: 86 },
        { label: '早餐', value: 89, benchmark: 83 },
      ],
      max: 100,
      valueLabel: '本酒店',
      benchmarkLabel: '同城均值',
    },
  },
  HotelRadialChart: {
    props: hotelRadialChartPropsSchema,
    description: '酒店单目标径向图。用于入住率、清扫进度、到账率等一个核心目标，不用于多指标。',
    example: {
      title: '今日入住率',
      label: '已售 / 可售',
      value: 78,
      max: 100,
      unit: '%',
    },
  },
  Skeleton: hotelComponent('Skeleton', '仅在酒店数据仍在读取时占位。'),
  Spinner: hotelComponent('Spinner', '仅在同步渠道或提交操作正在进行时显示。'),
  Tooltip: hotelComponent('Tooltip', '补充陌生指标或图标的短说明，不承载关键内容。'),
  Popover: hotelComponent('Popover', '显示房价构成、库存来源或状态解释等轻量详情。'),
  Input: hotelComponent('Input', '录入订单号、房量、价格或宾客检索条件。'),
  Textarea: hotelComponent('Textarea', '录入点评回复、交班备注或服务记录。'),
  Select: hotelComponent('Select', '选择酒店、渠道、房型、订单或任务状态。'),
  Checkbox: hotelComponent('Checkbox', '选择独立布尔条件或批量处理对象。'),
  Radio: hotelComponent('Radio', '在少量互斥的入住、退款或价格策略中选择。'),
  Switch: hotelComponent('Switch', '启停可立即理解且可逆的渠道或提醒设置。'),
  Slider: hotelComponent('Slider', '调整价格幅度或阈值，并同步显示明确数值。'),
  Button: hotelComponent('Button', '触发查看、确认、起草、同步或导出等具体结果。'),
  Link: hotelComponent('Link', '跳转到可信的酒店、订单或渠道页面。'),
  DropdownMenu: hotelComponent('DropdownMenu', '收纳低频的订单、房态或报表次要操作。'),
  Toggle: hotelComponent('Toggle', '切换单个视图条件，例如仅看异常。'),
  ToggleGroup: hotelComponent('ToggleGroup', '切换日期范围、楼层、渠道或房态视图。'),
  ButtonGroup: hotelComponent('ButtonGroup', '组织少量互斥的处理动作，保持一个主操作。'),
  Pagination: hotelComponent('Pagination', '翻阅较长的订单、账务、点评或工单列表。'),
};

export const hotelGenerativeUiCatalog = defineCatalog(schema, {
  components: hotelComponentDefinitions,
  actions: {},
});

export const HOTEL_GENERATIVE_UI_RULES = [
  '只展示完成当前酒店运营任务所需的信息和操作。',
  '涉及价格、库存、订单、支付和宾客服务时，明确酒店、渠道、日期及状态口径。',
  '列表比较优先使用 Table；单对象详情优先使用 Card；紧急风险使用 Alert。',
  '连续趋势使用 HotelAreaChart 或 HotelLineChart；离散比较使用 HotelBarChart；构成使用 HotelDonutChart；单目标使用 HotelRadialChart；统一量纲的多维表现才使用 HotelRadarChart。',
  '图表必须提供单位和数据来源；不要同时用重复指标卡和图表表达同一组数据。',
  '不要生成无法执行的主要操作；没有后端能力时将按钮标记为禁用或省略。',
  '宾客个人信息遵循最小披露原则，不展示证件号、手机号等敏感字段。',
] as const;

export const HOTEL_GENERATIVE_UI_COMPONENT_COUNT = Object.keys(hotelComponentDefinitions).length;
