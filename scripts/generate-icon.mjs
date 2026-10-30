import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const size = 256
const bg = [30, 30, 30, 255]
const panel = [60, 60, 60, 255]
const fg = [204, 204, 204, 255]
const pixels = Buffer.alloc(size * size * 4)

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return
  }
  const offset = (y * size + x) * 4
  pixels[offset] = color[0]
  pixels[offset + 1] = color[1]
  pixels[offset + 2] = color[2]
  pixels[offset + 3] = color[3]
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      setPixel(x, y, color)
    }
  }
}

function drawLine(x0, y0, x1, y1, width, color) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(x0 + (dx * i) / steps)
    const y = Math.round(y0 + (dy * i) / steps)
    const radius = Math.ceil(width / 2)
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (ox * ox + oy * oy <= radius * radius) {
          setPixel(x + ox, y + oy, color)
        }
      }
    }
  }
}

fillRect(0, 0, size, size, bg)
fillRect(28, 28, 228, 228, panel)
drawLine(78, 188, 128, 68, 10, fg)
drawLine(128, 68, 178, 188, 10, fg)
drawLine(96, 148, 160, 148, 10, fg)

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput))
  return Buffer.concat([length, crcInput, crc])
}

const raw = Buffer.alloc((size * 4 + 1) * size)
for (let y = 0; y < size; y += 1) {
  const rowStart = y * (size * 4 + 1)
  raw[rowStart] = 0
  pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(size, 0)
ihdr.writeUInt32BE(size, 4)
ihdr[8] = 8
ihdr[9] = 6

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

const dir = join(dirname(fileURLToPath(import.meta.url)), '../build')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'icon.png'), png)

const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry[0] = 0
entry[1] = 0
entry[2] = 0
entry[3] = 0
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12)
writeFileSync(join(dir, 'icon.ico'), Buffer.concat([icoHeader, entry, png]))

console.log(`wrote ${join(dir, 'icon.png')} and icon.ico (${png.length} bytes png)`)
