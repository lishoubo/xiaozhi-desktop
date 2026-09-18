import { describe, expect, it } from 'vitest';
import { extractMeituanReadbackTargets } from '../../../src/main/channels/meituan/room-change-targets';
import type { JsonObject } from '../../../src/shared/types/json';

const INVENTORY = 'inventory-update';

/**
 * 构造一个写请求体。默认值取自 `docs/踩点/美团/房价房量日历-房量.md` 的真实样本。
 */
function changeRaw(models: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    poiId: '1834077877',
    partnerId: 4824962,
    changeType: 1,
    modifyInventoryModelList: models,
    ...extra,
  };
}

function model(
  dayRoomIds: number[],
  ranges: { startDate: string; endDate: string }[],
  weekParams: JsonObject[],
  hourRoomIds: number[] = [],
): JsonObject {
  return {
    modifyInventorySubjectsModel: {
      goodsIdList: [],
      dayRoomIdList: dayRoomIds,
      hourRoomIdList: hourRoomIds,
    },
    unifiedOperateInvDateModel: {
      modifyDates: ranges,
      modifyParamByEffectWeeks: weekParams,
    },
  };
}

/** 一个周次档。`countType` 等参数回读不读，给真实值只为贴近样本。 */
function weekParam(effectWeek: number[] | undefined, countType = 1520): JsonObject {
  return {
    ...(effectWeek === undefined ? {} : { effectWeek }),
    updateInventoryUnifyInvUnitParam: {
      invSwitch: -1,
      countType,
      limitChangeValue: 20,
      count: 0,
    },
  };
}

const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];

describe('extractMeituanReadbackTargets', () => {
  it('只认房量端点，其余一律不回读', () => {
    const raw = changeRaw([model([493879575], [{ startDate: '2026-10-20', endDate: '2026-10-20' }], [weekParam(ALL_WEEK)])]);
    for (const other of ['inventory-status-switch', 'inventory-roomstatus-submitaudit', 'price-update']) {
      expect(extractMeituanReadbackTargets(other, raw, INVENTORY)).toBeNull();
    }
    expect(extractMeituanReadbackTargets(INVENTORY, raw, INVENTORY)).not.toBeNull();
  });

  // 真实样本：`房价房量日历-房量.md` 的「剩余房量，设置一个值(20)」
  it('单房型单日', () => {
    const targets = extractMeituanReadbackTargets(
      INVENTORY,
      changeRaw([model([493879575], [{ startDate: '2026-10-20', endDate: '2026-10-20' }], [weekParam(ALL_WEEK)])]),
      INVENTORY,
    );
    expect(targets).toEqual({
      roomIds: [493879575],
      dates: ['2026-10-20'],
      poiId: '1834077877',
      partnerId: 4824962,
    });
  });

  // 真实样本：`批量改房态房量.md`，3 个 model 共用同一组日期与周次档
  it('多房型共用同一组日期 —— 汇总房型，日期不重复', () => {
    const ranges = [
      { startDate: '2026-09-09', endDate: '2026-09-11' },
      { startDate: '2026-08-27', endDate: '2026-08-28' },
    ];
    const params = [weekParam([1, 2, 3, 4, 7]), weekParam([5, 6])];
    const targets = extractMeituanReadbackTargets(
      INVENTORY,
      changeRaw([
        model([493882496], ranges, params),
        model([493899418], ranges, params),
        model([493899623], ranges, params),
      ]),
      INVENTORY,
    );

    expect(targets?.roomIds).toEqual([493882496, 493899418, 493899623]);
    // 两档星期并集 = 全周 → 两个区间全展开，且**不因三个 model 而重复**
    expect(targets?.dates).toEqual([
      '2026-08-27',
      '2026-08-28',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
    ]);
  });

  it('多个周次档取并集', () => {
    // 2026-09-14 是周一，连续 7 天覆盖完整一周
    const week = [{ startDate: '2026-09-14', endDate: '2026-09-20' }];
    const targets = extractMeituanReadbackTargets(
      INVENTORY,
      changeRaw([model([1], week, [weekParam([1, 2]), weekParam([5, 6])])]),
      INVENTORY,
    );
    // 并集 {1,2,5,6} = 周一二五六
    expect(targets?.dates).toEqual(['2026-09-14', '2026-09-15', '2026-09-18', '2026-09-19']);
  });

  describe('星期基准 —— ISO，1 = 周一', () => {
    // 2026-09-14(周一) ~ 2026-09-20(周日)
    const week = [{ startDate: '2026-09-14', endDate: '2026-09-20' }];
    const datesFor = (effectWeek: number[]): readonly string[] | undefined =>
      extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([model([1], week, [weekParam(effectWeek)])]),
        INVENTORY,
      )?.dates;

    // ⚠️ 唯一能抓住基准写反的用例：若把 1 当成周日，这里会得到 09-20
    it('[1] → 周一，不是周日', () => {
      expect(datesFor([1])).toEqual(['2026-09-14']);
    });

    it('[7] → 周日', () => {
      expect(datesFor([7])).toEqual(['2026-09-20']);
    });

    // 真实样本：`批量改房态房量.md` 的关房档，业务语义是「周末关房」
    it('[5,6] → 周五周六', () => {
      expect(datesFor([5, 6])).toEqual(['2026-09-18', '2026-09-19']);
    });

    it('[1,2,3,4,7] 与 [5,6] 互补，合起来正好是全周', () => {
      const a = datesFor([1, 2, 3, 4, 7]) ?? [];
      const b = datesFor([5, 6]) ?? [];
      expect([...a, ...b].sort()).toEqual([
        '2026-09-14',
        '2026-09-15',
        '2026-09-16',
        '2026-09-17',
        '2026-09-18',
        '2026-09-19',
        '2026-09-20',
      ]);
    });
  });

  describe('星期缺失或为空 = 不过滤', () => {
    const week = [{ startDate: '2026-09-14', endDate: '2026-09-20' }];
    const expectFullWeek = (params: JsonObject[]): void => {
      const targets = extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([model([1], week, params)]),
        INVENTORY,
      );
      expect(targets?.dates).toHaveLength(7);
    };

    it('effectWeek 为空数组', () => expectFullWeek([weekParam([])]));

    /**
     * ⚠️ 「没有星期概念」与「报文形状不符」是两件事。
     *
     * 早先把「全部元素非法」也当成不过滤，造成一个**不对称**：`[5,99]` 只丢坏元素、
     * 过滤照做（1 天），而 `[0]` 反而整个区间全展开（7 天）—— 后者是**多读**，
     * 服务端拿 cells 去追价会把用户没碰过的日期跟到别的渠道。
     *
     * 形状不符时唯一安全的做法是整次放弃回读，与服务端 `RawBodyReader.weekdaysFromInts`
     * 的 fail-closed 同向（它对这些情况一律 throw malformed）。
     */
    describe('⚠️ effectWeek 形状不符 → 整次放弃回读（不是不过滤）', () => {
      const expectNullFor = (effectWeek: unknown): void => {
        const targets = extractMeituanReadbackTargets(
          INVENTORY,
          changeRaw([model([1], week, [weekParam(effectWeek as number[])])]),
          INVENTORY,
        );
        expect(targets).toBeNull();
      };

      it('[0] 越界（全部非法）', () => expectNullFor([0]));
      it('[8, 9] 越界', () => expectNullFor([8, 9]));
      it('[5, 99] 部分非法 —— 与全部非法同等对待，不许只丢坏元素', () => expectNullFor([5, 99]));
      it('["x"] 非整数', () => expectNullFor(['x']));
      it('[1.5] 小数', () => expectNullFor([1.5]));
      it('"5,6" 不是数组', () => expectNullFor('5,6'));

      it('周次档本身不是对象', () => {
        const targets = extractMeituanReadbackTargets(
          INVENTORY,
          changeRaw([model([1], week, ['not-an-object' as unknown as JsonObject])]),
          INVENTORY,
        );
        expect(targets).toBeNull();
      });

      it('⚠️ 一个档形状不符 → 整次放弃，不能只丢那一档', () => {
        const targets = extractMeituanReadbackTargets(
          INVENTORY,
          changeRaw([model([1], week, [weekParam([5, 6]), weekParam([0])])]),
          INVENTORY,
        );
        expect(targets).toBeNull();
      });

      it('null 元素跳过（与服务端 `if (item == null) continue` 一致），不算非法', () => {
        const targets = extractMeituanReadbackTargets(
          INVENTORY,
          changeRaw([model([1], week, [weekParam([5, null as unknown as number, 6])])]),
          INVENTORY,
        );
        expect(targets?.dates).toEqual(['2026-09-18', '2026-09-19']);
      });
    });
    it('effectWeek 字段缺失', () => expectFullWeek([weekParam(undefined)]));
    it('modifyParamByEffectWeeks 为空数组', () => expectFullWeek([]));
    it('任一档不过滤则整体不过滤', () => expectFullWeek([weekParam([5, 6]), weekParam([])]));
  });

  describe('钟点房', () => {
    const range = [{ startDate: '2026-10-22', endDate: '2026-10-22' }];

    // 真实样本：`房价房量日历-房量.md` 的「钟点房设置房量」
    it('整次只有钟点房 → 不回读', () => {
      const targets = extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([model([], range, [weekParam(ALL_WEEK)], [493879575])]),
        INVENTORY,
      );
      expect(targets).toBeNull();
    });

    it('只含钟点房的 model 被跳过，其余 model 照常', () => {
      const targets = extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([
          model([], range, [weekParam(ALL_WEEK)], [493879575]),
          model([493882496], range, [weekParam(ALL_WEEK)]),
        ]),
        INVENTORY,
      );
      expect(targets?.roomIds).toEqual([493882496]);
    });

    it('同一 model 里 day 与 hour 并存时只取 day', () => {
      const targets = extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([model([493882496], range, [weekParam(ALL_WEEK)], [493879575])]),
        INVENTORY,
      );
      expect(targets?.roomIds).toEqual([493882496]);
    });
  });

  describe('空输入一律返回 null，不退化为全量', () => {
    const range = [{ startDate: '2026-10-20', endDate: '2026-10-20' }];
    const expectNull = (raw: JsonObject): void => {
      expect(extractMeituanReadbackTargets(INVENTORY, raw, INVENTORY)).toBeNull();
    };

    it('modifyInventoryModelList 缺失', () => {
      // 解构省略而非赋 undefined —— JsonValue 不含 undefined，且「键不存在」才是真实形态
      const { modifyInventoryModelList: _omitted, ...raw } = changeRaw([]);
      expectNull(raw);
    });
    it('modifyInventoryModelList 为空数组', () => expectNull(changeRaw([])));
    it('dayRoomIdList 为空', () => expectNull(changeRaw([model([], range, [weekParam(ALL_WEEK)])])));
    it('modifyDates 为空', () => expectNull(changeRaw([model([1], [], [weekParam(ALL_WEEK)])])));
    it('poiId 缺失', () => {
      const { poiId: _omitted, ...raw } = changeRaw([model([1], range, [weekParam(ALL_WEEK)])]);
      expectNull(raw);
    });
    it('poiId 为空串', () => expectNull(changeRaw([model([1], range, [weekParam(ALL_WEEK)])], { poiId: '  ' })));
    it('partnerId 缺失', () => {
      const { partnerId: _omitted, ...raw } = changeRaw([model([1], range, [weekParam(ALL_WEEK)])]);
      expectNull(raw);
    });
    it('星期过滤后一天都不剩', () => {
      // 单日 2026-09-14 是周一，只要周六
      expectNull(
        changeRaw([model([1], [{ startDate: '2026-09-14', endDate: '2026-09-14' }], [weekParam([6])])]),
      );
    });
  });

  describe('日期区间', () => {
    it('闭区间，两端都含', () => {
      const targets = extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([model([1], [{ startDate: '2026-09-14', endDate: '2026-09-16' }], [weekParam(ALL_WEEK)])]),
        INVENTORY,
      );
      expect(targets?.dates).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
    });

    it('起止颠倒的区间被跳过', () => {
      const targets = extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([
          model(
            [1],
            [
              { startDate: '2026-09-16', endDate: '2026-09-14' },
              { startDate: '2026-09-20', endDate: '2026-09-20' },
            ],
            [weekParam(ALL_WEEK)],
          ),
        ]),
        INVENTORY,
      );
      expect(targets?.dates).toEqual(['2026-09-20']);
    });

    it('跨月区间正确展开', () => {
      const targets = extractMeituanReadbackTargets(
        INVENTORY,
        changeRaw([model([1], [{ startDate: '2026-09-29', endDate: '2026-10-02' }], [weekParam(ALL_WEEK)])]),
        INVENTORY,
      );
      expect(targets?.dates).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    });
  });

  it('房型 id 去重且升序', () => {
    const range = [{ startDate: '2026-10-20', endDate: '2026-10-20' }];
    const targets = extractMeituanReadbackTargets(
      INVENTORY,
      changeRaw([
        model([493899623, 493882496], range, [weekParam(ALL_WEEK)]),
        model([493882496], range, [weekParam(ALL_WEEK)]),
      ]),
      INVENTORY,
    );
    expect(targets?.roomIds).toEqual([493882496, 493899623]);
  });

  it('partnerId 与 poiId 取自报文顶层（不是凭证）', () => {
    const targets = extractMeituanReadbackTargets(
      INVENTORY,
      changeRaw([model([1], [{ startDate: '2026-10-20', endDate: '2026-10-20' }], [weekParam(ALL_WEEK)])], {
        poiId: 9_999,
        partnerId: '12345',
      }),
      INVENTORY,
    );
    // 数字 poiId 转成串、字符串 partnerId 转成数 —— 两者在样本里类型都不固定
    expect(targets?.poiId).toBe('9999');
    expect(targets?.partnerId).toBe(12345);
  });
});
