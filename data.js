/*
 * 院内データ
 * - 下地の地図：近畿大学病院 公式フロアマップ画像（maps/floor01〜07.png）
 *   https://www.med.kindai.ac.jp/floormap_facility.html
 * - 座標は各階の画像のピクセル座標。廊下・エレベーター・入口の位置は公式画像から読み取ったもの。
 * - 駅デッキがどの出入口につながるか、7号館（管理棟）の店舗への行き方、距離は公開情報からの推定。
 */
window.HOSPITAL = {
  metersPerPx: 0.12, // 画像1pxあたりの距離（推定）

  floors: {
    1: { img: "maps/floor01.png", w: 1758, h: 1200 },
    2: { img: "maps/floor02.png", w: 1994, h: 1200 },
    3: { img: "maps/floor03.png", w: 1758, h: 892 },
    4: { img: "maps/floor04.png", w: 1758, h: 1060 },
    5: { img: "maps/floor05.png", w: 1758, h: 1060 },
    6: { img: "maps/floor06.png", w: 1758, h: 1060 },
    7: { img: "maps/floor07.png", w: 1758, h: 1060 },
    // 8〜10階は院内図面をもとに作成した簡略図（tools/make_ward_maps.js で生成）
    8: { img: "maps/floor08.png", w: 1758, h: 1060 },
    9: { img: "maps/floor09.png", w: 1758, h: 1060 },
    10: { img: "maps/floor10.png", w: 1758, h: 1060 }
  },

  // 各階の通路ノード（廊下の分岐点など）
  nodes: {
    1: {
      ev1w: [181, 425], ev1c: [557, 677],
      a1: [200, 470], a2: [150, 560], b1: [520, 700]
    },
    2: {
      ev1w: [182, 425], A: [215, 455], B: [440, 455], B6: [443, 395], C: [600, 455], F: [705, 455], F6: [705, 395],
      G: [900, 465], H: [958, 468], H2: [980, 468], I: [1140, 468], ev2w: [1142, 600],
      J: [1500, 468], ev2e: [1499, 600], K: [1540, 468], L: [1545, 730],
      D: [600, 690], ev1c: [569, 677], esc: [630, 622], E: [600, 740], M: [940, 735], N: [1236, 730],
      R1: [1700, 745], R2: [1790, 810], W: [215, 675], inner: [430, 720], iL: [300, 720]
    },
    3: {
      ev1w: [178, 272], a: [215, 285], T: [400, 285], c: [630, 300],
      ev1c: [565, 519], esc: [625, 465], d: [630, 519], e: [640, 790],
      L0: [215, 400], L1: [215, 560], L2: [215, 830], entL: [327, 830], B3: [382, 830], Bt: [440, 830], inner: [400, 560],
      top2: [915, 320], tL: [1150, 320], wcol: [1185, 320], wcol2: [1185, 445], ev2w: [1150, 445], tR: [1440, 320],
      eR: [1440, 445], ev2e: [1494, 445],
      f1: [820, 785], f2: [915, 780], f3: [1045, 780], f4: [1185, 780], f5: [1292, 780], f6: [1318, 780], f7: [1440, 780], f8: [1600, 790],
      ent_c: [700, 845], ent_l: [327, 862], ent_p: [1318, 858]
    },
    4: {
      ev1w: [176, 425], w: [200, 440], t: [400, 440], c: [600, 450], esc: [622, 617], ev1c: [561, 673], d: [600, 673],
      inner: [400, 720], lft: [200, 770], btm: [600, 990],
      x1: [700, 472], x2: [900, 472], x3: [990, 472], up: [990, 260], x4: [1080, 520], x5: [1090, 598], ev2w: [1124, 598]
    },
    5: {
      ev1w: [173, 425], w: [200, 440], t: [400, 440], c: [600, 450], esc: [621, 618], ev1c: [560, 673], d: [600, 673],
      inner: [400, 710], l1: [200, 610], l2: [200, 830], btm: [400, 975], btmR: [600, 975],
      x1: [700, 470], x2: [900, 470], x3: [968, 470], x4: [1083, 470], x11: [1417, 470], x7: [1530, 470],
      x8: [1530, 598], ev2e: [1491, 598], x9: [1530, 727], x10: [1314, 727], x6: [1083, 727], x5: [1083, 598], ev2w: [1122, 598]
    },
    6: {
      ev1w: [175, 425], w: [200, 430], a6: [367, 430], b6: [521, 430], c: [600, 450], esc: [623, 619], ev1c: [562, 675],
      d: [600, 675], m: [600, 858],
      x1: [700, 470], x2: [900, 470], x3: [1083, 470], x4: [1105, 470], x7: [1530, 470], x8: [1530, 600], ev2e: [1504, 600],
      x9: [1530, 727], x6: [1083, 727], x5: [1083, 600], ev2w: [1124, 600]
    },
    7: { ev2w: [1124, 598], y1: [1090, 598], y2: [1090, 745], t1: [1110, 470], t2: [1500, 470], e1: [1525, 598], ev2e: [1491, 598], e2: [1510, 700], b2: [1440, 745] },
    8: { ev2w: [1124, 598], x5: [1081, 598], x4: [1081, 470], x7: [1535, 470], x8: [1535, 598], ev2e: [1491, 598], x9: [1535, 728], x6: [1081, 728] },
    9: { ev2w: [1124, 598], x5: [1081, 598], x4: [1081, 470], x7: [1535, 470], x8: [1535, 598], ev2e: [1491, 598], x9: [1535, 728], x6: [1081, 728] },
    10: { ev2w: [1124, 598], x5: [1081, 598], x4: [1081, 470], x7: [1535, 470], x8: [1535, 598], ev2e: [1491, 598], x9: [1535, 728], x6: [1081, 728] }
  },

  // 通路（"a-b-c" は a→b→c とつながる廊下）
  paths: {
    1: ["ev1w-a1-a2", "ev1c-b1"],
    2: ["ev1w-A-B-C-F-G-H-H2-I-J-K-L", "C-D-E-M-N-L", "D-ev1c", "D-esc", "I-ev2w", "J-ev2e",
        "L-R1-R2", "A-W", "D-inner-iL", "B-B6", "F-F6"],
    3: ["ev1w-a-T-c-top2-tL-wcol-tR", "c-d-e-f1-f2-f3-f4-f5-f6-f7-f8", "d-ev1c", "d-esc",
        "a-L0-L1-L2-entL-B3-Bt-e", "L1-inner-d", "wcol-wcol2-f4", "wcol2-ev2w", "tR-eR-f7", "eR-ev2e",
        "e-ent_c", "entL-ent_l", "f6-ent_p"],
    4: ["ev1w-w-t-c-x1-x2-x3-x4-x5-ev2w", "c-d-btm", "d-ev1c", "d-esc", "d-inner", "w-lft", "x3-up"],
    5: ["ev1w-w-t-c-x1-x2-x3-x4-x11-x7-x8-x9-x10-x6-x5-x4", "x5-ev2w", "x8-ev2e", "c-d-btmR-btm",
        "d-ev1c", "d-esc", "d-inner", "w-l1-l2-btm"],
    6: ["ev1w-w-a6-b6-c-x1-x2-x3-x4-x7-x8-x9-x6-x5-x3", "x5-ev2w", "x8-ev2e", "c-d-m", "d-ev1c", "d-esc"],
    7: ["ev2w-y1-y2-b2-e2-e1-t2-t1-y1", "e1-ev2e"],
    8: ["ev2w-x5-x4-x7-x8-x9-x6-x5", "x8-ev2e"],
    9: ["ev2w-x5-x4-x7-x8-x9-x6-x5", "x8-ev2e"],
    10: ["ev2w-x5-x4-x7-x8-x9-x6-x5", "x8-ev2e"]
  },

  // 階をまたぐ移動
  lifts: [
    { id: "ev1w", name: "1号館 西側エレベーター", kind: "ev", floors: [1, 2, 3, 4, 5, 6] },
    { id: "ev1c", name: "1号館 中央エレベーター", kind: "ev", floors: [1, 2, 3, 4, 5, 6] },
    { id: "ev2w", name: "2号館 西EV", kind: "ev", floors: [2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { id: "ev2e", name: "2号館 東EV", kind: "ev", floors: [2, 3, 5, 6, 7, 8, 9, 10] },
    { id: "esc", name: "1号館 エスカレーター", kind: "esc", floors: [2, 3, 4, 5, 6] }
  ],

  // 行き先。at = 画像上の位置、via = つながる通路ノード、area = 建物
  places: [
    // 入口（3階）
    { id: "deck", name: "駅デッキ側 中央出入口", short: "駅デッキ", f: 3, at: [700, 860], via: "ent_c", area: "3階", group: "入口" },
    { id: "door1", name: "1号館側 出入口", f: 3, at: [327, 870], via: "ent_l", area: "1号館", group: "入口" },
    { id: "doorp", name: "駐車場側 出入口", f: 3, at: [1318, 868], via: "ent_p", area: "2号館", group: "入口" },

    // 1階
    { id: "pet", name: "アイソトープ・PET（1E）", f: 1, at: [115, 640], via: "a2", area: "1号館" },
    { id: "rt", name: "放射線治療室（1A）", f: 1, at: [442, 725], via: "b1", area: "1号館" },

    // 2階
    { id: "onco", name: "腫瘍内科（2B）", f: 2, at: [308, 600], via: "iL", area: "1号館" },
    { id: "palliative", name: "緩和ケア内科（2B）", f: 2, at: [308, 600], via: "iL", area: "1号館" },
    { id: "radonc", name: "放射線治療科（2B）", f: 2, at: [308, 600], via: "iL", area: "1号館" },
    { id: "surg", name: "外科（2A）", f: 2, at: [457, 600], via: "inner", area: "1号館" },
    { id: "nsurg", name: "脳神経外科（2F）", f: 2, at: [308, 865], via: "iL", area: "1号館" },
    { id: "neuro", name: "脳神経内科（2F）", f: 2, at: [308, 865], via: "iL", area: "1号館" },
    { id: "ortho", name: "整形外科（2G）", f: 2, at: [457, 865], via: "inner", area: "1号館" },
    { id: "chemo", name: "通院治療センター（2E）", short: "通院治療", f: 2, at: [110, 670], via: "W", area: "1号館" },
    { id: "seven", name: "コンビニ（セブン-イレブン）", short: "コンビニ", f: 2, at: [707, 625], via: "D", area: "1号館" },
    { id: "cancer", name: "がん相談支援センター（2J）", f: 2, at: [357, 315], via: "B6", area: "6号館" },
    { id: "pcc", name: "緩和ケアセンター（2J）", f: 2, at: [357, 315], via: "B6", area: "6号館" },
    { id: "crc", name: "臨床研究センター・治験（2K）", f: 2, at: [622, 325], via: "F6", area: "6号館" },
    { id: "endoscopy", name: "内視鏡センター（2L）", short: "内視鏡", f: 2, at: [1187, 330], via: "H2", area: "2号館" },
    { id: "gastro", name: "消化器内科（2P）", f: 2, at: [985, 620], via: "H", area: "2号館" },
    { id: "er", name: "救急外来・救急科（2R）", short: "救急外来", f: 2, at: [1069, 870], via: "M", area: "2号館" },
    { id: "radio", name: "中央放射線部（CT・MRIなど 2S）", short: "放射線部", f: 2, at: [1640, 570], via: "L", area: "2号館" },
    { id: "diagrad", name: "放射線診断科（2S）", f: 2, at: [1640, 570], via: "L", area: "2号館" },
    { id: "greenleaves", name: "コンビニ（グリーンリーブスモール）・医療雑貨", short: "売店", f: 2, at: [1825, 930], via: "R2", area: "3号館" },

    // 3階
    { id: "reception", name: "総合受付（初診窓口）", short: "総合受付", f: 3, at: [1045, 752], via: "f3", area: "2号館" },
    { id: "info", name: "インフォメーション", f: 3, at: [742, 745], via: "f1", area: "3階" },
    { id: "pharm", name: "おくすり受取カウンター", short: "おくすり", f: 3, at: [1325, 595], via: "f5", area: "2号館" },
    { id: "blood", name: "採血・生理検査（中央臨床検査部 3L）", short: "採血・検査", f: 3, at: [1300, 230], via: "tL", area: "2号館" },
    { id: "support", name: "患者支援センター・入院手続き・術前サポート外来（3P）", short: "入院手続き", f: 3, at: [980, 460], via: "f2", area: "2号館" },
    { id: "admit", name: "入院案内", f: 3, at: [1468, 798], via: "f7", area: "2号館" },
    { id: "laundry", name: "コインランドリー", f: 3, at: [1676, 768], via: "f8", area: "2号館" },
    { id: "lost", name: "防災センター（落とし物案内）", f: 3, at: [1585, 835], via: "f8", area: "2号館" },
    { id: "treat", name: "中央処置室（3A）", f: 3, at: [502, 416], via: "inner", area: "1号館" },
    { id: "cardio", name: "循環器内科（3B）", f: 3, at: [303, 416], via: "inner", area: "1号館" },
    { id: "hema", name: "血液内科（3B）", f: 3, at: [303, 416], via: "inner", area: "1号館" },
    { id: "cvs", name: "心臓血管外科（3C）", f: 3, at: [105, 373], via: "L0", area: "1号館" },
    { id: "peds", name: "小児科・思春期科（3E）", f: 3, at: [105, 618], via: "L1", area: "1号館" },
    { id: "rheum", name: "膠原病内科（3G）", f: 3, at: [379, 704], via: "B3", area: "1号館" },
    { id: "resp", name: "呼吸器・アレルギー内科（3G）", f: 3, at: [379, 704], via: "B3", area: "1号館" },

    // 4階
    { id: "ent", name: "耳鼻咽喉・頭頸部外科（4A）", short: "耳鼻咽喉科", f: 4, at: [376, 560], via: "inner", area: "1号館" },
    { id: "eye", name: "眼科（4E）", f: 4, at: [120, 770], via: "lft", area: "1号館" },
    { id: "plastic", name: "形成外科（4F）", f: 4, at: [301, 850], via: "inner", area: "1号館" },
    { id: "derma", name: "皮膚科（4G）", f: 4, at: [449, 850], via: "inner", area: "1号館" },
    { id: "anes", name: "麻酔科（4L）", f: 4, at: [1060, 215], via: "up", area: "2号館" },
    { id: "or", name: "中央手術部・外来手術（4P）", f: 4, at: [1014, 470], via: "x3", area: "2号館" },

    // 5階
    { id: "uro", name: "泌尿器科（5B）", f: 5, at: [299, 560], via: "inner", area: "1号館" },
    { id: "nephro", name: "腎臓内科（5A）", f: 5, at: [451, 560], via: "inner", area: "1号館" },
    { id: "kampo", name: "漢方診療科・遺伝子診療部（5C）", f: 5, at: [82, 610], via: "l1", area: "1号館" },
    { id: "dental", name: "歯科口腔外科（5E）", f: 5, at: [119, 830], via: "l2", area: "1号館" },
    { id: "endo", name: "内分泌・代謝・糖尿病内科（5G）", f: 5, at: [448, 855], via: "inner", area: "1号館" },
    { id: "nutri", name: "栄養相談室", f: 5, at: [340, 942], via: "btm", area: "1号館" },
    { id: "dialysis", name: "血液浄化センター（5L）", f: 5, at: [995, 315], via: "x3", area: "2号館" },
    { id: "icu", name: "ICU・CCU", f: 5, at: [1535, 912], via: "x9", area: "2号館", group: "病棟" },
    { id: "ccmc", name: "CCMC（救命救急センター）", f: 5, at: [1197, 912], via: "x10", area: "2号館", group: "病棟" },
    { id: "hcu", name: "HCU", f: 5, at: [1617, 311], via: "x7", area: "2号館", group: "病棟" },
    { id: "acu", name: "ACU", f: 5, at: [1348, 240], via: "x11", area: "2号館", group: "病棟" },
    { id: "scu", name: "SCU", f: 5, at: [982, 731], via: "x6", area: "2号館", group: "病棟" },

    // 6階
    { id: "gyne", name: "婦人科（6B）", f: 6, at: [302, 500], via: "a6", area: "1号館" },
    { id: "obst", name: "産科（6A）", f: 6, at: [447, 500], via: "b6", area: "1号館" },
    { id: "mental", name: "メンタルヘルス科（6G）", f: 6, at: [399, 820], via: "m", area: "1号館" },
    { id: "w6wa", name: "6西A病棟（小児科・思春期科）", f: 6, at: [1217, 320], via: "x4", area: "2号館", group: "病棟" },
    { id: "w6wb", name: "6西B病棟（NICU・GCU）", f: 6, at: [982, 800], via: "x5", area: "2号館", group: "病棟" },
    { id: "w6ea", name: "6東A病棟（消化器内科・婦人科）", f: 6, at: [1638, 600], via: "x8", area: "2号館", group: "病棟" },
    { id: "w6eb", name: "6東B病棟（産科・婦人科）", f: 6, at: [1597, 900], via: "x9", area: "2号館", group: "病棟" },

    // 7階
    { id: "rehab", name: "リハビリテーション室", f: 7, at: [1095, 853], via: "y2", area: "2号館" },

    // 7〜10階 病棟（院内図面より。病床数・職員用設備は省略）
    { id: "w7wa", name: "7西A病棟（血液内科）", f: 7, at: [1070, 350], via: "t1", area: "2号館", group: "病棟" },
    { id: "w7ea", name: "7東A病棟（整形外科・形成外科・皮膚科）", f: 7, at: [1530, 350], via: "t2", area: "2号館", group: "病棟" },
    { id: "w7eb", name: "7東B病棟（整形外科）", f: 7, at: [1530, 860], via: "b2", area: "2号館", group: "病棟" },
    { id: "w8wa", name: "8西A病棟（消化器内科）", f: 8, at: [1070, 350], via: "x4", area: "2号館", group: "病棟" },
    { id: "w8ea", name: "8東A病棟（脳神経外科・消化器内科）", f: 8, at: [1530, 350], via: "x7", area: "2号館", group: "病棟" },
    { id: "w8wb", name: "8西B病棟（呼吸器内科・内分泌代謝糖尿病内科・消化器内科）", f: 8, at: [1070, 860], via: "x6", area: "2号館", group: "病棟" },
    { id: "w8eb", name: "8東B病棟（呼吸器内科・消化器内科・外科）", f: 8, at: [1530, 860], via: "x9", area: "2号館", group: "病棟" },
    { id: "w9wa", name: "9西A病棟（腫瘍内科・緩和ケア・放射線治療科）", f: 9, at: [1070, 350], via: "x4", area: "2号館", group: "病棟" },
    { id: "w9ea", name: "9東A病棟（耳鼻咽喉科）", f: 9, at: [1530, 350], via: "x7", area: "2号館", group: "病棟" },
    { id: "w9wb", name: "9西B病棟（眼科・脳神経内科・麻酔科）", f: 9, at: [1070, 860], via: "x6", area: "2号館", group: "病棟" },
    { id: "w9eb", name: "9東B病棟（外科（肝胆膵・乳腺・下部））", f: 9, at: [1530, 860], via: "x9", area: "2号館", group: "病棟" },
    { id: "w10wa", name: "10西A病棟（心臓血管外科・循環器内科・腎臓内科）", f: 10, at: [1070, 350], via: "x4", area: "2号館", group: "病棟" },
    { id: "w10ea", name: "10東A病棟（泌尿器科・膠原病内科・放射線診断科・歯科口腔外科）", f: 10, at: [1530, 350], via: "x7", area: "2号館", group: "病棟" },
    { id: "w10wb", name: "10西B病棟（循環器内科）", f: 10, at: [1070, 860], via: "x6", area: "2号館", group: "病棟" },
    { id: "w10eb", name: "10東B病棟（外科（上部・下部））", f: 10, at: [1530, 860], via: "x9", area: "2号館", group: "病棟" },

    // 7号館（管理棟）：公式フロアマップ画像に掲載がないため、駅デッキ側出入口までを案内
    { id: "cafecore", name: "CAFE CORE（カフェ・コア）", f: 3, at: [700, 860], via: "ent_c", area: "7号館", group: "7号館（管理棟）", outside: "7号館（管理棟）3階" },
    { id: "cosme", name: "化粧品コーナー・西村眼鏡店・ヘアケア", f: 3, at: [700, 860], via: "ent_c", area: "7号館", group: "7号館（管理棟）", outside: "7号館（管理棟）3階" },
    { id: "ffields", name: "ffields（エフフィールド）", f: 3, at: [700, 860], via: "ent_c", area: "7号館", group: "7号館（管理棟）", outside: "7号館（管理棟）2階" }
  ],

  // 設備（公式フロアマップのアイコン位置）。行き先の「目的」から最寄りを探すのに使う
  amenities: [
    { kind: "toilet", f: 1, at: [568, 557] },
    { kind: "toilet", f: 2, at: [297, 332] }, { kind: "toilet", f: 2, at: [570, 556] },
    { kind: "toilet", f: 2, at: [1069, 620] }, { kind: "toilet", f: 2, at: [1694, 795] },
    { kind: "toilet", f: 3, at: [565, 400] }, { kind: "toilet", f: 3, at: [224, 529] },
    { kind: "toilet", f: 3, at: [565, 711] }, { kind: "toilet", f: 3, at: [1244, 690] },
    { kind: "toilet", f: 4, at: [561, 552] }, { kind: "toilet", f: 4, at: [221, 681] },
    { kind: "toilet", f: 4, at: [561, 864] }, { kind: "toilet", f: 4, at: [950, 294] },
    { kind: "toilet", f: 5, at: [561, 552] }, { kind: "toilet", f: 5, at: [220, 681] },
    { kind: "toilet", f: 5, at: [561, 864] }, { kind: "toilet", f: 5, at: [1221, 493] }, { kind: "toilet", f: 5, at: [1221, 700] },
    { kind: "toilet", f: 6, at: [568, 576] },
    // 7〜10階：院内図面より（中央エレベーターホール脇）
    { kind: "toilet", f: 7, at: [1242, 520] }, { kind: "toilet", f: 8, at: [1242, 520] },
    { kind: "toilet", f: 9, at: [1242, 520] }, { kind: "toilet", f: 10, at: [1242, 520] },
    { kind: "pay", f: 1, at: [613, 437] }, { kind: "pay", f: 2, at: [592, 987] }, { kind: "pay", f: 3, at: [590, 272] },
    { kind: "pay", f: 4, at: [583, 433] }, { kind: "pay", f: 5, at: [598, 985] }, { kind: "pay", f: 6, at: [608, 410] },
    { kind: "atm", f: 2, at: [928, 858] }, { kind: "atm", f: 3, at: [1240, 855] }
  ],
  amenityNames: { toilet: "トイレ", pay: "自動支払機", atm: "ATM" },

  // 目的から選ぶ。targets の中で一番近い場所へ案内する
  purposes: [
    { id: "first", name: "初めての受診・受付", short: "初診・受付", targets: ["reception"] },
    { id: "blood", name: "採血・尿検査・心電図などの検査", short: "採血・検査", targets: ["blood"] },
    { id: "image", name: "CT・MRI・レントゲン", short: "CT・MRI", targets: ["radio"] },
    { id: "scope", name: "胃カメラ・大腸カメラ（内視鏡）", short: "内視鏡", targets: ["endoscopy"] },
    { id: "pay", name: "会計・支払い（自動支払機）", short: "会計", amenity: "pay", note: "支払いの相談や窓口での手続きは3階の総合受付へ（推定）" },
    { id: "medicine", name: "お薬の受け取り", short: "お薬", targets: ["pharm"] },
    { id: "admission", name: "入院の手続き・術前の説明", short: "入院手続き", targets: ["support"] },
    { id: "chemo", name: "点滴・抗がん剤治療", short: "点滴・化学療法", targets: ["chemo"] },
    { id: "radiotherapy", name: "放射線治療", short: "放射線治療", targets: ["rt"] },
    { id: "consult", name: "がん・療養の相談", short: "がん相談", targets: ["cancer"] },
    { id: "toilet", name: "トイレ（いちばん近い所）", short: "トイレ", amenity: "toilet" },
    { id: "shop", name: "コンビニ・売店", short: "コンビニ", targets: ["seven", "greenleaves"] },
    { id: "cafe", name: "カフェ・食事", short: "カフェ", targets: ["cafecore", "ffields"] },
    { id: "atm", name: "ATM", short: "ATM", amenity: "atm" },
    { id: "lostfound", name: "落とし物", short: "落とし物", targets: ["lost"] },
    { id: "exit", name: "駅へ帰る（駅デッキ）", short: "駅へ", targets: ["deck"] }
  ],

  quick: ["first", "blood", "pay", "medicine", "image", "toilet", "shop", "exit"]
};
