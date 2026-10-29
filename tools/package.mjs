/**
 * Build the shareable ZIP: source + production build + reports, without node_modules.
 * Written in plain Node (zlib) so the packaging step needs no external `zip` binary.
 * Usage: node tools/package.mjs
 */
import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';

const OUT = 'ashen-vigil-1.0.0.zip';
const INCLUDE = [
  'src', 'tests', 'tools', 'dist', 'docs', 'reports',
  'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'README.md', 'LICENSES.md', 'PLAN.md',
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'shots']);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Collect the files that go into the archive, in a stable order. */
function collect(rel, out) {
  const abs = join(process.cwd(), rel);
  let st;
  try { st = statSync(abs); } catch { return; }
  if (st.isFile()) { out.push(rel); return; }
  for (const name of readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(name) || name === OUT || name.startsWith('.')) continue;
    collect(posix.join(rel, name), out);
  }
}

const files = [];
for (const item of INCLUDE) collect(item, files);
files.sort();

const now = dosTime(new Date());
const chunks = [];
const central = [];
let offset = 0;

for (const name of files) {
  const data = readFileSync(join(process.cwd(), name));
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const payload = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);          // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(now.time, 10);
  local.writeUInt16LE(now.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, nameBuf, payload);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4);
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(method, 10);
  dir.writeUInt16LE(now.time, 12);
  dir.writeUInt16LE(now.date, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(payload.length, 20);
  dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  dir.writeUInt32LE(0, 38);                 // external attributes
  dir.writeUInt32LE(offset, 42);
  central.push(dir, nameBuf);

  offset += local.length + nameBuf.length + payload.length;
}

const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

if (existsSync(OUT)) rmSync(OUT);
writeFileSync(OUT, Buffer.concat([...chunks, cdBuf, eocd]));

const bytes = statSync(OUT).size;
console.log(`${OUT}: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
