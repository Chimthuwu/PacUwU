// Dev-only: decode a PNG (pure node, zlib) and print a color-classified
// ASCII preview + average-brightness stats for headless verification.
const fs = require('node:fs');
const zlib = require('node:zlib');

function decodePng(path) {
  const buf = fs.readFileSync(path);
  let pos = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = raw[p++];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break;
        }
        default: throw new Error('bad filter');
      }
      row[x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

const [, , file, colsArg = '120', rowsArg = '52'] = process.argv;
const { width, height, data } = decodePng(file);
const cols = Math.min(Number(colsArg), width);
const rows = Math.min(Number(rowsArg), height);

function classify(r, g, b) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx - mn;
  if (lum < 12 || sat < 22) return ' ';
  if (lum > 185 && sat < 46) return '#';
  const ch =
    g > r && g > b && g - b > 55 ? 'G'
    : r > g && r > b && g > b * 1.35 && g > 105 ? 'O'
    : r > g && r > b && b > g ? 'P'
    : r > g && r > b ? 'Y'
    : b > r && b > g && r > b * 0.34 && r < b * 0.96 ? 'V'
    : b > r && g > r * 0.9 ? 'C'
    : r > g ? 'P'
    : 'C';
  return lum > 165 ? '#' : ch;
}

for (let ry = 0; ry < rows; ry++) {
  let line = '';
  for (let rx = 0; rx < cols; rx++) {
    const x = Math.floor((rx / cols) * width);
    const y = Math.floor((ry / rows) * height);
    const i = (y * width + x) * 3;
    line += classify(data[i], data[i + 1], data[i + 2]);
  }
  console.log(line);
}

// brightness stats for the center 70% (the canvas area)
let tot = 0, n = 0, hot = 0;
for (let y = Math.floor(height * 0.15); y < height * 0.92; y += 3) {
  for (let x = Math.floor(width * 0.12); x < width * 0.88; x += 3) {
    const i = (y * width + x) * 3;
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    tot += lum; n++;
    if (lum > 200) hot++;
  }
}
console.log(`\navg lum ${(tot / n).toFixed(1)}  |  >200 px ${((hot / n) * 100).toFixed(1)}%`);