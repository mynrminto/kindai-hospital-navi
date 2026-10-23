// 7号館（管理棟）2階・3階の簡易図を、公式フロアマップ（2階・3階）の下に描き足す。
// 公式マップには7号館の掲載がないため、公式サイトの施設案内（3階：CAFE CORE・化粧品・西村眼鏡店・ヘアケア、
// 2階：ffields）と、3階の駅デッキ側出入口の位置からの推定で描いている。
// 使い方: node tools/make_bldg7.js  （Playwright + Chromium が必要。元画像は maps/floor0X_official.png）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const LINE = "#2a6a96", BEIGE = "#f9f4e5", ROOM = "#e3ebf2";
const SHOP = { cafe: "#fde7cf", cosme: "#f9e0e8", ffields: "#e2efd9" };
const img = (n) => "data:image/png;base64," + fs.readFileSync(path.join(__dirname, `../maps/${n}`)).toString("base64");
const ev = img("icon-ev.png");

// 7号館の外形（3階の座標）。2階は3階より153px下（3階画像のずれ）
const X0 = 430, X1 = 1000, Y0 = 1000, Y1 = 1230;

const rect = (x, y, w, h, fill, sw = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${LINE}" stroke-width="${sw}"/>`;
const text = (x, y, s, size = 22, fill = "#222", anchor = "middle", weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;
// 店名は公式マップのコンビニと同じく地の色の上に黒字で書く（ストリートビューが店の範囲を色で読み取るため）
const tag = (x, y, lines) => lines.map((l, i) => text(x, y + 8 + (i - (lines.length - 1) / 2) * 28, l, 22, "#222", "middle", 700)).join("");

// 建物の共通部分：外形、中央の廊下（南北）、東西の廊下、エレベーター
function building(dy, floorName) {
  const y0 = Y0 + dy, y1 = Y1 + dy, cy = 1095 + dy;
  let s = rect(X0, y0, X1 - X0, y1 - y0, ROOM, 2.5);
  s += `<rect x="${X0 + 1}" y="${cy}" width="${X1 - X0 - 2}" height="50" fill="${BEIGE}"/>`; // 東西の廊下
  s += `<rect x="640" y="${cy + 50}" width="120" height="${y1 - cy - 51}" fill="${BEIGE}"/>`; // エレベーターホール
  s += `<line x1="640" y1="${cy + 50}" x2="640" y2="${y1}" stroke="${LINE}"/><line x1="760" y1="${cy + 50}" x2="760" y2="${y1}" stroke="${LINE}"/>`;
  s += `<line x1="${X0}" y1="${cy}" x2="${X1}" y2="${cy}" stroke="${LINE}"/>`;
  s += `<line x1="${X0}" y1="${cy + 50}" x2="640" y2="${cy + 50}" stroke="${LINE}"/><line x1="760" y1="${cy + 50}" x2="${X1}" y2="${cy + 50}" stroke="${LINE}"/>`;
  // エレベーター（ホールの突き当たり）
  s += rect(650, y1 - 52, 100, 52, "#dfe7ef") + `<image href="${ev}" x="678" y="${y1 - 48}" width="44" height="44"/>`;
  s += text(700, y1 - 62, "7号館EV", 16);
  s += text(535, y1 - 32, "事務室など", 18, "#555") + text(880, y1 - 32, "事務室など", 18, "#555");
  s += text(X0, y1 + 30, `7号館（管理棟）${floorName}　簡易図（推定）`, 20, "#444", "start", 700);
  return s;
}

function floor3() {
  let s = building(0, "3階");
  // 駅デッキ側 中央出入口から7号館への連絡通路
  s += `<rect x="674" y="857" width="52" height="${Y0 - 857 + 1}" fill="${BEIGE}"/>`;
  s += `<line x1="674" y1="886" x2="674" y2="${Y0}" stroke="${LINE}"/><line x1="726" y1="886" x2="726" y2="${Y0}" stroke="${LINE}"/>`;
  s += text(740, 950, "連絡通路（推定）", 18, "#555", "start");
  // 入口ホール（南北の廊下）
  s += `<rect x="640" y="${Y0 + 1}" width="120" height="94" fill="${BEIGE}"/>`;
  s += `<rect x="726" y="${Y0 - 1}" width="${X1 - 726}" height="2" fill="${LINE}"/><rect x="${X0}" y="${Y0 - 1}" width="${674 - X0}" height="2" fill="${LINE}"/>`;
  s += `<line x1="640" y1="${Y0}" x2="640" y2="1095" stroke="${LINE}"/><line x1="760" y1="${Y0}" x2="760" y2="1095" stroke="${LINE}"/>`;
  // 店舗
  s += rect(X0 + 1, Y0 + 1, 639 - X0, 94, SHOP.cafe) + tag(535, 1048, ["CAFE CORE"]);
  s += rect(760, Y0 + 1, X1 - 761, 94, SHOP.cosme) + tag(880, 1048, ["化粧品・眼鏡", "ヘアケア"]);
  return s;
}

function floor2() {
  const dy = 153;
  let s = building(dy, "2階");
  s += rect(X0 + 1, Y0 + dy + 1, X1 - X0 - 2, 94, SHOP.ffields) + tag(715, 1048 + dy, ["ffields（エフフィールド）"]);
  s += text(X1 + 14, 1120 + dy, "3階の連絡通路から", 17, "#555", "start") + text(X1 + 14, 1144 + dy, "7号館EVで2階へ", 17, "#555", "start");
  return s;
}

function page(W, H, base, body) {
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0}text{font-family:"IPAPGothic","IPAGothic",sans-serif}</style>
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fff"/><image href="${img(base)}" x="0" y="0"/>${body}</svg>`;
}

(async () => {
  const exe = require("child_process").execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome").toString().trim();
  const b = await chromium.launch({ executablePath: exe });
  for (const [f, W, H, body] of [[3, 1758, 1270, floor3()], [2, 1994, 1430, floor2()]]) {
    const p = await b.newPage({ viewport: { width: W, height: H } });
    await p.setContent(page(W, H, `floor0${f}_official.png`, body));
    await p.screenshot({ path: path.join(__dirname, `../maps/floor0${f}.png`) });
    console.log("wrote floor", f);
  }
  await b.close();
})();
