curl 'https://life.douyin.com/life/account/v2/poi/relation/search?root_life_account_id=7129809840498706464&life_biz_view_id=22&life_account_biz_ids=' \
  -H 'ac-tag: smb_s' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: zh-CN,zh;q=0.9;q=0.9,en-US;q=0.8;q=0.8,en;q=0.7;q=0.7' \
  -H 'agw-js-conv: str' \
  -H 'content-type: application/json' \
  -b 'gd_random=eyJwZXJjZW50IjowLjQ0ODkxMTE3MzgzMTQ5MDI2fQ%3D%3D.mc6GhkL6hHiS4BOELA33zN1sAgQqBn3aEDa7mcydrHk%3D; gfkadpd=299467,22075; csrf_session_id=d460230c4f47cc5aa9ab8b91177bba08; x-web-secsdk-uid=c1cf1ed6-136b-4dde-9dd5-83e85d4e566f; is_staff_user_ls=false; gd_random=eyJwZXJjZW50IjowLjUwMDkzNTcyNTQwNDI5NX0%3D.lUtDqbrd6msEiPLpup45FZjnQsS0omEMvgGa93uPU9c%3D; is_hit_partitioned_cookie_canary=true; sessionid_ls=f02d9980c773082783258f9bfe96a013; uid_tt_ls=747937c0781839708fd73193a48e5db5; session_tlb_tag_ls=sttt%7C7%7C8C2ZgMdzCCeDJY-b_pagE_________-iVFTMUY4UycTD_pFabHWwIZH1Q3HZ5v6eUaAO9RAXwyc%3D; passport_csrf_token_default=ab0b4aafdba58fcaccf2f4b8731ff520; gfkadpd=299467,22075; sid_ucp_v1_ls=1.0.0-KGIyZWQ5MTZlZjYzMGJkOTk5N2VlZjY2ODc0NGFhZWNmNzU5MTQ1MmYKGAiwyKr7hQMQ2JSk0QYY0cESIAw4AkDvBxoCaGwiIGYwMmQ5OTgwYzc3MzA4Mjc4MzI1OGY5YmZlOTZhMDEz; odin_tt=421b6c5859ae42480249e45e2e7b320066179fa3bd9957b651fad0a5ea9670e72ad8b1e42b02bffc3192fa8bd65172cb; ssid_ucp_v1_ls=1.0.0-KGIyZWQ5MTZlZjYzMGJkOTk5N2VlZjY2ODc0NGFhZWNmNzU5MTQ1MmYKGAiwyKr7hQMQ2JSk0QYY0cESIAw4AkDvBxoCaGwiIGYwMmQ5OTgwYzc3MzA4Mjc4MzI1OGY5YmZlOTZhMDEz; sessionid_ss_ls=f02d9980c773082783258f9bfe96a013; sid_tt_ls=f02d9980c773082783258f9bfe96a013; sid_guard_ls=f02d9980c773082783258f9bfe96a013%7C1784782642%7C1475881%7CSun%2C+09-Aug-2026+06%3A55%3A23+GMT; has_biz_token_ls=false; x-web-secsdk-uid=2d67799b-3b3e-4dfb-9cc1-c9b6208adc1d; passport_csrf_token=ab0b4aafdba58fcaccf2f4b8731ff520; csrf_session_id=d460230c4f47cc5aa9ab8b91177bba08; uid_tt_ss_ls=747937c0781839708fd73193a48e5db5; is_hit_partitioned_cookie_canary_ss=true; ttwid=1%7CvjhbdmLOlndYkSeXR5y_nw-NI81-BZgnosKz78chMpk%7C1785837937%7C93e640e8f3381cbcf5622f59d4b9de4518b138464ef936656884850b2f81b528' \
  -H 'origin: https://life.douyin.com' \
  -H 'priority: u=1, i' \
  -H 'referer: https://life.douyin.com/p/travel-ari/hotel/price_amount_state?groupid=1740676251868171&life_biz_view_id=22&life_account_biz_ids=' \
  -H 'rpc-persist-life-merchant-role: 0' \
  -H 'rpc-persist-life-merchant-switch-role: 1' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-origin' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \
  -H 'x-secsdk-csrf-token: 0001000000015da914d1c6f100c98cdd18d9dbdcc0284787314da5cf482da5a38d78cd987d7b18c89224568b416b' \
  -H 'x-tt-ls-session-id: 5b7c1cd2-9297-4814-a145-58a771cf754e' \
  -H 'x-tt-trace-id: 00-cc3c9e0a18be3be1e121491cb-cc3c9e0a18be3be1-01' \
  -H 'x-tt-trace-log: 01' \
  --data-raw '{"page_size":15,"page_index":1,"search_params":{"relation_types":[1,2,3,5,7,8,10],"permission_key_list":["hermes.goods.product_create"],"main_category_list":{"first_level_category_id_list":["08"],"second_level_category_id_list":[],"third_level_category_id_list":["980302"]},"sub_category_list":{"first_level_category_id_list":["08"],"second_level_category_id_list":[],"third_level_category_id_list":["980302"]},"poi_name":"","poi_aggregate_name":"","filter_account_biz":false},"filter_params":{}}'


  ```
  {
    "data": {
        "list": [
            {
                "account_marks": [
                    47,
                    46
                ],
                "account_type": 20,
                "app_key": 10148,
                "confer_parent_life_account_id": "7642232304953313334",
                "confer_root_life_account_id": "7129809840498706464",
                "key_account_id": "1865778200910980",
                "labels": [
                    "已认领"
                ],
                "life_account_id": "7129809840498706464",
                "main_category": "080601",
                "owner_user_id": "2749256394085975",
                "parent_life_account_id": "7642232304953313334",
                "poi_account_biz": [],
                "poi_address": "天津北街11号",
                "poi_city_code": 210100,
                "poi_district_code": 210102,
                "poi_id": "7604739211807164466",
                "poi_lbs_city_code": 210100,
                "poi_lbs_district_code": 210102,
                "poi_lbs_province_code": 21,
                "poi_life_account_id": "7642223602787534890",
                "poi_name": "艺选酒店(沈阳站太原街医大一院店)",
                "poi_open_status": 1,
                "poi_position": {
                    "latitude": 41.792476,
                    "longitude": 123.398774
                },
                "poi_province_code": 210000,
                "poi_remark_name": "",
                "relation_type": 1,
                "root_life_account_id": "7129809840498706464",
                "settle_status_before_claim": 2,
                "store_id": "7642227559115114530",
                "sub_category": []
            }
        ],
        "pagination": {
            "page_index": 1,
            "page_size": 15,
            "total_count": 1
        },
        "use_label": false
    },
    "log_id": "2026080418055280E992BDD9AF8A6B475B",
    "now": "1785837952452",
    "status_code": 0,
    "status_msg": ""
}
  ```

  