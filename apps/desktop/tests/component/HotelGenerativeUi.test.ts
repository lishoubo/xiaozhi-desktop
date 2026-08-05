import { validateSpec } from '@json-render/core';
import { describe, expect, it } from 'vitest';
import {
  HOTEL_GENERATIVE_UI_COMPONENT_COUNT,
  HOTEL_GENERATIVE_UI_RULES,
  hotelComponentDefinitions,
  hotelGenerativeUiCatalog,
} from '../../src/renderer/generative-ui/catalog';
import { hotelGenerativeUiPreviews } from '../../src/renderer/generative-ui/mock-specs';

describe('hotel generative UI catalog', () => {
  it('exposes the complete shadcn-svelte vocabulary with hotel-specific guidance', () => {
    expect(HOTEL_GENERATIVE_UI_COMPONENT_COUNT).toBe(36);
    expect(Object.keys(hotelComponentDefinitions)).toEqual(
      expect.arrayContaining(['Table', 'Card', 'Alert', 'Progress', 'Tabs', 'Input', 'Dialog']),
    );
    expect(hotelComponentDefinitions.Table.description).toContain('订单、房态、库存');
    expect(HOTEL_GENERATIVE_UI_RULES).toHaveLength(5);

    const prompt = hotelGenerativeUiCatalog.prompt({
      customRules: [...HOTEL_GENERATIVE_UI_RULES],
    });
    expect(prompt).toContain('酒店业务用法');
    expect(prompt).toContain('宾客个人信息遵循最小披露原则');
  });

  it('provides structurally valid mock specs for common hotel workflows', () => {
    expect(hotelGenerativeUiPreviews).toHaveLength(10);
    expect(hotelGenerativeUiPreviews.map((preview) => preview.id)).toEqual([
      'operations',
      'exceptions',
      'rooms',
      'arrivals',
      'rates',
      'channels',
      'guests',
      'finance',
      'reviews',
      'revenue',
    ]);

    for (const preview of hotelGenerativeUiPreviews) {
      expect(validateSpec(preview.spec, { checkOrphans: true }), preview.id).toEqual({
        valid: true,
        issues: [],
      });
      const catalogValidation = hotelGenerativeUiCatalog.validate(preview.spec);
      expect(
        catalogValidation.success,
        `${preview.id}: ${catalogValidation.success ? '' : catalogValidation.error.message}`,
      ).toBe(true);
    }
  });
});
