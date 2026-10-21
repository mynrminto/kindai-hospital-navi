// 病棟フロアマップ（7〜10階）を公式フロアマップと同じ見た目で生成する。
// 院内図面をもとに、患者・面会者向けの情報（病棟名・診療科・見舞客用EV・廊下）だけを描く。
// 使い方: node tools/make_ward_maps.js  （Playwright + Chromium が必要）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const W = 1758, H = 1060;
const NAVY = "#0b4a78", LINE = "#2a6a96", BEIGE = "#f9f4e5", ROOM = "#f5f5f5", CORE = "#f9f4e5";
const TINT = { wa: "#e0ecd8", ea: "#e3ebf2", wb: "#fbdde0", eb: "#fde4b8" };
const icon = (n) => "data:image/png;base64," + fs.readFileSync(path.join(__dirname, `../maps/${n}.png`)).toString("base64");
const ev = icon("icon-ev"), men = icon("icon-01"), women = icon("icon-02");
// 中央のエレベーターホール脇のトイレ（院内図面より）
const toilets = () => `<image href="${men}" x="1200" y="500" width="40" height="40"/><image href="${women}" x="1244" y="500" width="40" height="40"/>`;

const WARDS = {
  7: { wa: ["7西A", "血液内科"], ea: ["7東A", "整形外科・形成外科・皮膚科"], eb: ["7東B", "整形外科"] },
  8: { wa: ["8西A", "消化器内科"], ea: ["8東A", "脳神経外科・消化器内科"], wb: ["8西B", "呼吸器内科・糖尿病内科ほか"], eb: ["8東B", "呼吸器内科・消化器内科・外科"] },
  9: { wa: ["9西A", "腫瘍内科・放射線治療科"], ea: ["9東A", "耳鼻咽喉科"], wb: ["9西B", "眼科・脳神経内科・麻酔科"], eb: ["9東B", "外科（肝胆膵・乳腺ほか）"] },
  10: { wa: ["10西A", "心臓血管外科・循環器内科・腎臓内科"], ea: ["10東A", "泌尿器科・膠原病内科ほか"], wb: ["10西B", "循環器内科"], eb: ["10東B", "外科"] }
};
// 病棟ラベルの位置（公式7階画像の診療棟と同じ座標系）
const POS = { wa: [1070, 330], ea: [1530, 330], wb: [1070, 850], eb: [1530, 850] };

function label([code, dept], [x, y]) {
  const cw = code.length * 30 + 34;
  let lines = [dept];
  if (dept.length > 10) {
    // 「・」のうち真ん中に近い位置で2行に分ける
    const cuts = [...dept].map((ch, i) => (ch === "・" ? i : -1)).filter((i) => i > 0);
    const mid = dept.length / 2;
    const cut = cuts.length ? cuts.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : Math.ceil(mid);
    lines = [dept.slice(0, cut + (dept[cut] === "・" ? 1 : 0)), dept.slice(cut + (dept[cut] === "・" ? 1 : 0))];
  }
  const lw = Math.max(...lines.map((l) => l.length)) * 25 + 30, lh = lines.length * 32 + 16;
  return `
  <rect x="${x - cw / 2}" y="${y - 70}" width="${cw}" height="52" rx="7" fill="#fff" stroke="${NAVY}" stroke-width="2.5"/>
  <text x="${x}" y="${y - 32}" font-size="30" fill="${NAVY}" text-anchor="middle" font-weight="700">${code}</text>
  <rect x="${x - lw / 2}" y="${y - 8}" width="${lw}" height="${lh}" fill="${NAVY}"/>
  ${lines.map((l, i) => `<text x="${x}" y="${y + 26 + i * 32}" font-size="24" fill="#fff" text-anchor="middle" letter-spacing="1">${l}</text>`).join("")}`;
}

function evIcons(x, name, labelDx) {
  return `
  <image href="${ev}" x="${x - 22}" y="529" width="44" height="44"/>
  <image href="${ev}" x="${x - 22}" y="617" width="44" height="44"/>
  <text x="${x + labelDx}" y="606" font-size="17" fill="#222" text-anchor="middle">${name}</text>`;
}

function tower(f) {
  const w = WARDS[f];
  const quad = { wa: [897, 183, 408, 415], ea: [1305, 183, 415, 415], wb: [897, 598, 408, 412], eb: [1305, 598, 415, 412] };
  let s = "";
  s += `<rect x="897" y="183" width="823" height="827" fill="${ROOM}" stroke="${LINE}" stroke-width="2"/>`;
  for (const k of Object.keys(quad)) {
    if (!w[k]) continue;
    const [x, y, ww, hh] = quad[k];
    s += `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" fill="${TINT[k]}" stroke="${LINE}" stroke-width="1"/>`;
  }
  // 中庭（吹き抜け）
  for (const [x, y] of [[1180, 300], [1365, 300], [1180, 780], [1365, 780]]) {
    s += `<rect x="${x}" y="${y}" width="105" height="125" fill="#fff" stroke="${LINE}" stroke-width="1"/>`;
  }
  // 廊下：外周リング・中央リング・つなぎ
  const corr = (x, y, ww, hh) => `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" fill="${BEIGE}" stroke="${LINE}" stroke-width="1"/>`;
  s += corr(965, 250, 690, 28) + corr(965, 905, 690, 28) + corr(965, 250, 28, 683) + corr(1627, 250, 28, 683);
  s += corr(1062, 452, 492, 36) + corr(1062, 710, 492, 36) + corr(1062, 452, 38, 294) + corr(1516, 452, 38, 294);
  s += corr(1291, 278, 28, 174) + corr(1291, 746, 28, 159) + corr(993, 585, 69, 28) + corr(1554, 585, 73, 28);
  // 中央コア（職員エリアなど・非公開）
  s += `<rect x="1100" y="488" width="416" height="222" fill="${CORE}" stroke="${LINE}" stroke-width="1"/>`;
  s += `<text x="1308" y="612" font-size="18" fill="#777" text-anchor="middle">エレベーターホール</text>` + toilets();
  s += evIcons(1124, "西EV", -28) + evIcons(1491, "東EV", 34);
  // 方位の目安
  s += `<text x="1308" y="168" font-size="18" fill="#555" text-anchor="middle">診療棟（2号館）${f}階　病棟フロア</text>`;
  for (const k of Object.keys(POS)) if (w[k]) s += label(w[k], POS[k]);
  return s;
}

function page(f, base) {
  const bg = base
    ? `<image href="data:image/png;base64,${fs.readFileSync(base).toString("base64")}" x="0" y="0" width="${W}" height="${H}"/>`
    : `<rect width="${W}" height="${H}" fill="#fff"/>`;
  // 7階は公式マップ（リハビリテーション室）を下地にラベルだけ重ねる
  const body = base ? Object.keys(POS).filter((k) => WARDS[f][k]).map((k) => label(WARDS[f][k], POS[k])).join("") +
      toilets() + evIcons(1491, "東EV", 34).replace(/<text[^>]*>東EV<\/text>/, `<text x="1525" y="606" font-size="17" fill="#222" text-anchor="middle">東EV</text>`)
    : tower(f);
  const note = `<text x="30" y="1045" font-size="16" fill="#777">病棟フロアは院内図面をもとに作成した簡略図です（非公式）</text>`;
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0}text{font-family:"IPAPGothic","IPAGothic",sans-serif}</style>
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}${body}${note}</svg>`;
}

(async () => {
  const exe = require("child_process").execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome").toString().trim();
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  for (const f of [7, 8, 9, 10]) {
    const base = f === 7 ? path.join(__dirname, "../maps/floor07_official.png") : null;
    await p.setContent(page(f, base));
    await p.screenshot({ path: path.join(__dirname, `../maps/floor${String(f).padStart(2, "0")}.png`) });
    console.log("wrote floor", f);
  }
  await b.close();
})();
