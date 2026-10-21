/*
 * 院内データ
 * - 診療科・施設の「建物」と「階」：近畿大学病院 公式フロアマップ（https://www.med.kindai.ac.jp/floormap_facility.html）
 *   および外来案内・交通アクセスページに基づく。
 * - 建物の配置・連絡通路・EV/エスカレーター位置・座標：公開情報からの推定（模式図）。
 * 座標系は 430 x 370 の模式図。1px ≒ 0.6m として所要時間を見積もる。
 */
window.HOSPITAL = {
  updated: "2026-10",
  metersPerPx: 0.6,

  buildings: {
    b1: { name: "1号館", sub: "外来棟", rect: [14, 18, 172, 262], core: [100, 262], floors: [1, 2, 3, 4, 5, 6, 7] },
    b2: { name: "2号館", sub: "診療棟", rect: [204, 18, 142, 200], core: [275, 200], floors: [1, 2, 3, 4, 5] },
    b3: { name: "3号館", sub: "", rect: [356, 18, 60, 92], core: [386, 100], floors: [2] },
    b6: { name: "6号館", sub: "", rect: [356, 120, 60, 98], core: [386, 210], floors: [2] },
    b7: { name: "7号館", sub: "管理棟", rect: [276, 258, 140, 96], core: [346, 264], floors: [2, 3] }
  },

  // 各階の通路ノード（推定）
  nodes: {
    // 1号館・2号館の連絡部（推定：2〜5階で接続）
    j12_2: { f: 2, x: 195, y: 230 }, j12_3: { f: 3, x: 195, y: 230 },
    j12_4: { f: 4, x: 195, y: 230 }, j12_5: { f: 5, x: 195, y: 230 },
    // 3階 エントランスホール（駅デッキ連絡階）
    hall: { f: 3, x: 238, y: 238, label: "エントランス" },
    // 2号館 2階⇔3階 エスカレーター（推定）
    esc_2: { f: 2, x: 222, y: 212, label: "ESC" }, esc_3: { f: 3, x: 222, y: 212, label: "ESC" },
    // 2号館と3号館・6号館の連絡部（推定：2階）
    j23: { f: 2, x: 351, y: 64 }, j26: { f: 2, x: 351, y: 168 },
    // デッキと7号館入口（3階）
    deckmid: { f: 3, x: 238, y: 300 },
    j7: { f: 3, x: 276, y: 300 }
  },

  // 階をまたがない通路（同じ階のノード間）。core は "b1@3" のように表す
  links: [
    ["b1@2", "j12_2"], ["j12_2", "b2@2"],
    ["b1@3", "j12_3"], ["j12_3", "hall"], ["hall", "b2@3"],
    // 4・5階の連絡は案内上の優先度を下げる（主動線は2・3階と推定）
    ["b1@4", "j12_4", 20], ["j12_4", "b2@4"],
    ["b1@5", "j12_5", 20], ["j12_5", "b2@5"],
    ["esc_2", "b2@2"], ["esc_3", "hall"],
    ["b2@2", "j23"], ["j23", "b3@2"],
    ["b2@2", "j26"], ["j26", "b6@2"],
    ["hall", "deckmid"], ["deckmid", "j7"], ["j7", "b7@3"]
  ],

  // 階をまたぐ移動（エレベーターは各建物のコアで自動生成）
  escalators: [["esc_2", "esc_3"]],

  // 施設・診療科（bldg と floor は公式フロアマップより）
  places: [
    { id: "deck", name: "駅からのデッキ入口（泉ケ丘駅方面）", short: "駅デッキ", b: "deck", f: 3, at: [238, 352], tags: ["入口"] },

    // 1号館（外来棟）
    { id: "rehab", name: "リハビリテーション室", b: "b1", f: 7 },
    { id: "obst", name: "産科（産婦人科）", short: "産科", b: "b1", f: 6 },
    { id: "gyne", name: "婦人科（産婦人科）", short: "婦人科", b: "b1", f: 6 },
    { id: "mental", name: "メンタルヘルス科", b: "b1", f: 6 },
    { id: "nephro", name: "腎臓内科", b: "b1", f: 5 },
    { id: "uro", name: "泌尿器科", b: "b1", f: 5 },
    { id: "kampo", name: "漢方診療科・遺伝子診療部", short: "漢方・遺伝子", b: "b1", f: 5 },
    { id: "dental", name: "歯科口腔外科", b: "b1", f: 5 },
    { id: "endo", name: "内分泌・代謝・糖尿病内科", short: "糖尿病内科", b: "b1", f: 5 },
    { id: "nutri", name: "栄養相談室", b: "b1", f: 5 },
    { id: "ent", name: "耳鼻咽喉・頭頸部外科", short: "耳鼻咽喉科", b: "b1", f: 4 },
    { id: "eye", name: "眼科", b: "b1", f: 4 },
    { id: "plastic", name: "形成外科", b: "b1", f: 4 },
    { id: "derma", name: "皮膚科", b: "b1", f: 4 },
    { id: "treat", name: "中央処置室", b: "b1", f: 3 },
    { id: "hema", name: "血液内科（血液・膠原病内科）", short: "血液内科", b: "b1", f: 3 },
    { id: "cardio", name: "循環器内科", b: "b1", f: 3 },
    { id: "cvs", name: "心臓血管外科", b: "b1", f: 3 },
    { id: "peds", name: "小児科・思春期科", short: "小児科", b: "b1", f: 3 },
    { id: "rheum", name: "膠原病内科（血液・膠原病内科）", short: "膠原病内科", b: "b1", f: 3 },
    { id: "resp", name: "呼吸器・アレルギー内科", short: "呼吸器内科", b: "b1", f: 3 },
    { id: "surg", name: "外科", b: "b1", f: 2 },
    { id: "onco", name: "腫瘍内科", b: "b1", f: 2 },
    { id: "palliative", name: "緩和ケア内科", b: "b1", f: 2 },
    { id: "radonc", name: "放射線治療科", b: "b1", f: 2 },
    { id: "chemo", name: "通院治療センター", short: "通院治療C", b: "b1", f: 2 },
    { id: "ortho", name: "整形外科", b: "b1", f: 2 },
    { id: "nsurg", name: "脳神経外科", b: "b1", f: 2 },
    { id: "neuro", name: "脳神経内科", b: "b1", f: 2 },
    { id: "seven", name: "コンビニ（セブン-イレブン）", short: "セブン", b: "b1", f: 2, tags: ["売店"] },
    { id: "rt", name: "放射線治療室", b: "b1", f: 1 },
    { id: "pet", name: "アイソトープ・PET", short: "RI・PET", b: "b1", f: 1 },

    // 2号館（診療棟）
    { id: "dialysis", name: "血液浄化センター", b: "b2", f: 5 },
    { id: "anes", name: "麻酔科", b: "b2", f: 4 },
    { id: "or", name: "中央手術部", b: "b2", f: 4 },
    { id: "reception", name: "総合受付（初診窓口）", short: "総合受付", b: "b2", f: 3, tags: ["受付"] },
    { id: "info", name: "インフォメーション・情報コーナー", short: "案内", b: "b2", f: 3 },
    { id: "pharm", name: "おくすり受付カウンター", short: "おくすり", b: "b2", f: 3 },
    { id: "blood", name: "採血・生理検査（中央臨床検査部）", short: "採血・検査", b: "b2", f: 3 },
    { id: "admit", name: "入院案内", b: "b2", f: 3 },
    { id: "support", name: "患者支援センター（入院手続き・術前サポート外来）", short: "患者支援C", b: "b2", f: 3 },
    { id: "laundry", name: "コインランドリー", short: "ランドリー", b: "b2", f: 3 },
    { id: "lost", name: "防災センター（落とし物案内）", short: "防災C", b: "b2", f: 3 },
    { id: "endoscopy", name: "内視鏡センター", short: "内視鏡", b: "b2", f: 2 },
    { id: "gastro", name: "消化器内科", b: "b2", f: 2 },
    { id: "er", name: "救急外来", b: "b2", f: 2 },
    { id: "radio", name: "中央放射線部（CT・MRI等）", short: "放射線部", b: "b2", f: 2 },
    { id: "diagrad", name: "放射線診断科", short: "放射線診断", b: "b2", f: 2 },

    // 3号館
    { id: "greenleaves", name: "コンビニ（グリーンリーブスモール）", short: "コンビニ", b: "b3", f: 2, tags: ["売店"] },
    { id: "medshop", name: "医療材料・医療雑貨", short: "医療雑貨", b: "b3", f: 2 },

    // 6号館
    { id: "crc", name: "臨床研究センター（治験）", short: "治験", b: "b6", f: 2 },
    { id: "cancer", name: "がん相談支援センター", short: "がん相談", b: "b6", f: 2 },
    { id: "pcc", name: "緩和ケアセンター", short: "緩和ケアC", b: "b6", f: 2 },

    // 7号館（管理棟）
    { id: "cafecore", name: "CAFE CORE（カフェ・コア）", short: "CAFE CORE", b: "b7", f: 3, tags: ["カフェ"] },
    { id: "cosme", name: "化粧品コーナー", short: "化粧品", b: "b7", f: 3 },
    { id: "glasses", name: "西村眼鏡店", short: "眼鏡店", b: "b7", f: 3 },
    { id: "hair", name: "スヴェンソン近大ヘアケアステーション", short: "ヘアケア", b: "b7", f: 3 },
    { id: "ffields", name: "ffields（エフフィールド）", short: "ffields", b: "b7", f: 2, tags: ["カフェ"] }
  ],

  // よく使う行き先（チップ）
  quick: ["reception", "blood", "pharm", "radio", "chemo", "greenleaves", "cafecore", "deck"]
};
