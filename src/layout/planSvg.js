import { TYPE_CONFIG, TYPE_ORDER, typeZone, nearestSameTypePair, isManual, manualFields } from './engine.js'

function esc(value) {
  return String(value ?? '').replace(/[<>&"']/g, (ch) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch])
}

function textLabel(x, y, text, options = {}) {
  const size = options.size || 13
  const weight = options.weight || 600
  const color = options.color || '#0f172a'
  const anchor = options.anchor || 'middle'
  const lines = Array.isArray(text) ? text : [text]
  const lineHeight = size * 1.35
  const maxChars = Math.max(...lines.map((line) => String(line).length))
  const width = options.width || maxChars * size * 0.72 + 18
  const height = lines.length * lineHeight + 12
  let rectX = x - width / 2
  let textX = x
  if (anchor === 'start') {
    rectX = x - 8
    textX = x
  }
  if (anchor === 'end') {
    rectX = x - width + 8
    textX = x - 4
  }
  const rect = options.background === false
    ? ''
    : `<rect x="${rectX}" y="${y - size - 4}" width="${width}" height="${height}" rx="7" fill="${options.bg || '#ffffff'}" opacity="${options.bgOpacity ?? 0.9}"/>`
  const tspans = lines.map((line, i) =>
    `<tspan x="${textX}" dy="${i === 0 ? size : lineHeight}">${esc(line)}</tspan>`
  ).join('')
  return `<g>${rect}<text x="${textX}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" font-family="'Microsoft YaHei','PingFang SC',system-ui,sans-serif">${tspans}</text></g>`
}

function dimensionLine(x1, y1, x2, y2, label, options = {}) {
  const color = options.color || '#334155'
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const rotate = options.rotateLabel || 0
  return `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.8" marker-start="url(#plan-arrow)" marker-end="url(#plan-arrow)"/>
    <line x1="${x1}" y1="${y1}" x2="${x1 + (options.tickX || 0)}" y2="${y1 + (options.tickY || 0)}" stroke="${color}" stroke-width="1.4"/>
    <line x1="${x2}" y1="${y2}" x2="${x2 + (options.tickX || 0)}" y2="${y2 + (options.tickY || 0)}" stroke="${color}" stroke-width="1.4"/>
    <g transform="rotate(${rotate} ${midX} ${midY})">${textLabel(midX, midY + 5, label, { size: 13, color, background: true })}</g>
  `
}

function spacingAnnotation(pair, X, Y, color, siteCenter, labelText) {
  const x1 = X(pair.a.x)
  const y1 = Y(pair.a.z)
  const x2 = X(pair.b.x)
  const y2 = Y(pair.b.z)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.max(1, Math.hypot(dx, dy))
  let nx = -dy / len
  let ny = dx / len
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const outwardDot = nx * (mx - siteCenter.x) + ny * (my - siteCenter.y)
  if (outwardDot < 0) {
    nx *= -1
    ny *= -1
  }
  const offset = 34
  const q1x = x1 + nx * offset
  const q1y = y1 + ny * offset
  const q2x = x2 + nx * offset
  const q2y = y2 + ny * offset
  const gap = Math.max(0, pair.gap)
  const label = labelText || `${gap.toFixed(1)}m`
  return `
    <line x1="${x1}" y1="${y1}" x2="${q1x}" y2="${q1y}" stroke="${color}" stroke-width="1.1" stroke-dasharray="3 3" opacity=".65"/>
    <line x1="${x2}" y1="${y2}" x2="${q2x}" y2="${q2y}" stroke="${color}" stroke-width="1.1" stroke-dasharray="3 3" opacity=".65"/>
    <line x1="${q1x}" y1="${q1y}" x2="${q2x}" y2="${q2y}" stroke="${color}" stroke-width="1.8" marker-start="url(#plan-arrow)" marker-end="url(#plan-arrow)"/>
    ${textLabel((q1x + q2x) / 2, (q1y + q2y) / 2 + 5, label, { size: 12, color, bg: '#fffbeb' })}
  `
}

function objectShape(o, X, Y, selectedId) {
  const cfg = TYPE_CONFIG[o.type]
  const cx = X(o.x)
  const cy = Y(o.z)
  const w = cfg.size.w * (o.scale || 1) * X.scale
  const d = cfg.size.d * (o.scale || 1) * X.scale
  const selected = o.id === selectedId
  const manual = isManual(o)
  let shape = ''

  if (o.type === 'tent') {
    shape = `
      <polygon points="${-w / 2},${d / 2} ${w / 2},${d / 2} 0,${-d / 2}" fill="${cfg.color}" stroke="#7c2d12" stroke-width="1.5"/>
      <line x1="0" y1="${-d / 2}" x2="0" y2="${d / 2}" stroke="#fff7ed" stroke-width="1.2" opacity=".85"/>
      <rect x="${-w * 0.13}" y="${d * 0.12}" width="${w * 0.26}" height="${d * 0.38}" rx="2" fill="#111827" opacity=".75"/>`
  } else if (o.type === 'assembly') {
    const r = Math.max(w, d) / 2
    shape = `
      <circle r="${r}" fill="${cfg.color}" stroke="#14532d" stroke-width="1.5"/>
      <circle r="${r * 0.58}" fill="none" stroke="#ffffff" stroke-width="2" opacity=".9"/>
      <text y="5" text-anchor="middle" font-size="${Math.max(12, r * 0.7)}" font-weight="800" fill="#ffffff">集</text>`
  } else if (o.type === 'supply') {
    shape = `
      <rect x="${-w / 2}" y="${-d / 2}" width="${w}" height="${d}" rx="4" fill="${cfg.color}" stroke="#1e3a8a" stroke-width="1.5"/>
      <rect x="${-w * 0.34}" y="${-d * 0.28}" width="${w * 0.28}" height="${d * 0.28}" rx="2" fill="#bfdbfe"/>
      <rect x="${w * 0.06}" y="${-d * 0.28}" width="${w * 0.28}" height="${d * 0.28}" rx="2" fill="#fde68a"/>
      <rect x="${-w * 0.2}" y="${d * 0.08}" width="${w * 0.4}" height="${d * 0.25}" rx="2" fill="#93c5fd"/>`
  } else {
    const r = 5.2
    shape = `
      <circle r="${r + 2.2}" fill="#ffffff" opacity=".95"/>
      <circle r="${r}" fill="${cfg.color}" stroke="#7f1d1d" stroke-width="1.2"/>
      <circle cy="-1.4" r="1.7" fill="#fecaca"/>`
  }

  const labelY = o.type === 'stake' ? 17 : d / 2 + 15
  const labelSize = o.type === 'stake' ? 8.5 : 11
  const shortPrefix = { tent: '帐', assembly: '集', supply: '物' }[o.type] || ''
  const label = o.type === 'stake'
    ? `<text y="${labelY}" text-anchor="middle" font-size="${labelSize}" fill="#7f1d1d" font-weight="700">${esc(o.index)}</text>`
    : `<text y="${labelY}" text-anchor="middle" font-size="${labelSize}" fill="#0f172a" font-weight="800" stroke="#ffffff" stroke-width="3.2" paint-order="stroke">${shortPrefix}${String(o.index).padStart(2, '0')}</text>`

  const manualBadge = manual
    ? `<g transform="translate(${Math.max(w / 2, 8)},${-Math.max(d / 2, 8)})">
         <circle r="8" fill="#f59e0b" stroke="#ffffff" stroke-width="2"/>
         <text y="3.4" text-anchor="middle" font-size="9" font-weight="900" fill="#ffffff">M</text>
       </g>`
    : ''
  const halo = selected
    ? (o.type === 'stake'
      ? `<circle r="13" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-dasharray="4 3"/>`
      : `<rect x="${-w / 2 - 7}" y="${-d / 2 - 7}" width="${w + 14}" height="${d + 14}" rx="8" fill="none" stroke="#0ea5e9" stroke-width="3" stroke-dasharray="7 4"/>`)
    : ''

  return `<g transform="translate(${cx} ${cy}) rotate(${-Number(o.rotation || 0)})">${halo}${shape}${manualBadge}${label}</g>`
}

export function buildPlanSvg({ params, objects = [], seed = '', selectedId = null, createdAt = '' }) {
  const p = params
  const manualObjects = objects.filter(isManual)
  const width = 1280
  const height = Math.max(880, 390 + manualObjects.length * 23 + 250)
  const frame = { x: 34, y: 92, w: 858, h: height - 158 }
  const draw = { x: frame.x + 72, y: frame.y + 58, w: frame.w - 128, h: frame.h - 128 }
  const scale = Math.min(draw.w / p.length, draw.h / p.width)
  const siteW = p.length * scale
  const siteH = p.width * scale
  const ox = draw.x + (draw.w - siteW) / 2
  const oy = draw.y + (draw.h - siteH) / 2
  const X = Object.assign((x) => ox + (x + p.length / 2) * scale, { scale })
  const Y = (z) => oy + (z + p.width / 2) * scale

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Microsoft YaHei','PingFang SC',system-ui,sans-serif">`)
  parts.push(`
    <defs>
      <marker id="plan-arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="#334155"/>
      </marker>
      <filter id="plan-shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#0f172a" flood-opacity=".14"/>
      </filter>
    </defs>`)
  parts.push(`<rect width="${width}" height="${height}" fill="#f8fafc"/>`)
  parts.push(`<text x="42" y="48" font-size="28" font-weight="900" fill="#0f172a">应急演练场地布置图</text>`)
  parts.push(`<text x="42" y="74" font-size="14" fill="#64748b">场地尺寸 ${p.length}m × ${p.width}m　|　主通道：${p.orientation === 'length' ? '沿场地长轴' : '沿场地短轴'}　|　种子 ${esc(seed)}　|　${esc(createdAt)}</text>`)

  // 图框
  parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" rx="18" fill="#ffffff" stroke="#e2e8f0" filter="url(#plan-shadow)"/>`)

  // 网格
  const grid = []
  for (let wx = Math.ceil(-p.length / 2 / 5) * 5; wx <= p.length / 2 + 0.01; wx += 5) {
    grid.push(`<line x1="${X(wx)}" y1="${oy}" x2="${X(wx)}" y2="${oy + siteH}" stroke="${Math.round(wx / 5) % 2 === 0 ? '#d6d3c7' : '#ece7da'}" stroke-width="1"/>`)
  }
  for (let wz = Math.ceil(-p.width / 2 / 5) * 5; wz <= p.width / 2 + 0.01; wz += 5) {
    grid.push(`<line x1="${ox}" y1="${Y(wz)}" x2="${ox + siteW}" y2="${Y(wz)}" stroke="${Math.round(wz / 5) % 2 === 0 ? '#d6d3c7' : '#ece7da'}" stroke-width="1"/>`)
  }
  parts.push(`<g>${grid.join('')}</g>`)

  // 场地和通道
  parts.push(`<rect x="${ox}" y="${oy}" width="${siteW}" height="${siteH}" fill="#f2ecdd" fill-opacity=".72" stroke="#334155" stroke-width="2.4"/>`)
  if (p.orientation === 'length') {
    parts.push(`<rect x="${ox}" y="${Y(-p.passageWidth / 2)}" width="${siteW}" height="${p.passageWidth * scale}" fill="#94a3b8" opacity=".34"/>`)
    parts.push(`<line x1="${ox}" y1="${Y(0)}" x2="${ox + siteW}" y2="${Y(0)}" stroke="#ffffff" stroke-width="2.2" stroke-dasharray="14 10"/>`)
    parts.push(`<line x1="${ox}" y1="${Y(-p.passageWidth / 2)}" x2="${ox + siteW}" y2="${Y(-p.passageWidth / 2)}" stroke="#f59e0b" stroke-width="1.8"/>`)
    parts.push(`<line x1="${ox}" y1="${Y(p.passageWidth / 2)}" x2="${ox + siteW}" y2="${Y(p.passageWidth / 2)}" stroke="#f59e0b" stroke-width="1.8"/>`)
  } else {
    parts.push(`<rect x="${X(-p.passageWidth / 2)}" y="${oy}" width="${p.passageWidth * scale}" height="${siteH}" fill="#94a3b8" opacity=".34"/>`)
    parts.push(`<line x1="${X(0)}" y1="${oy}" x2="${X(0)}" y2="${oy + siteH}" stroke="#ffffff" stroke-width="2.2" stroke-dasharray="14 10"/>`)
    parts.push(`<line x1="${X(-p.passageWidth / 2)}" y1="${oy}" x2="${X(-p.passageWidth / 2)}" y2="${oy + siteH}" stroke="#f59e0b" stroke-width="1.8"/>`)
    parts.push(`<line x1="${X(p.passageWidth / 2)}" y1="${oy}" x2="${X(p.passageWidth / 2)}" y2="${oy + siteH}" stroke="#f59e0b" stroke-width="1.8"/>`)
  }

  // 分区
  for (const type of TYPE_ORDER) {
    const zone = typeZone(objects, type, 1.3)
    if (!zone) continue
    const cfg = TYPE_CONFIG[type]
    parts.push(`<rect x="${X(zone.minX)}" y="${Y(zone.minZ)}" width="${(zone.maxX - zone.minX) * scale}" height="${(zone.maxZ - zone.minZ) * scale}" rx="10" fill="${cfg.color}" fill-opacity=".07" stroke="${cfg.color}" stroke-opacity=".65" stroke-width="1.8" stroke-dasharray="9 6"/>`)
    parts.push(textLabel(X(zone.minX) + 10, Y(zone.minZ) - 9, cfg.zone || `${cfg.label}区`, { anchor: 'start', size: 13, color: cfg.color, width: 96 }))
  }

  // 间距标注：图上用引出尺寸线标数值，右侧图签列出每类实际/标准净距。
  const pairMap = Object.fromEntries(TYPE_ORDER.map((type) => [type, nearestSameTypePair(objects, type)]))
  const siteCenter = { x: ox + siteW / 2, y: oy + siteH / 2 }
  const graphicSpacingType = ['tent', 'supply', 'assembly'].find((type) => pairMap[type])
  if (graphicSpacingType) {
    parts.push(spacingAnnotation(
      pairMap[graphicSpacingType],
      X,
      Y,
      '#b45309',
      siteCenter,
      `${TYPE_CONFIG[graphicSpacingType].label}净距 ${Math.max(0, pairMap[graphicSpacingType].gap).toFixed(1)}m`
    ))
  }

  // 物件
  for (const o of objects) parts.push(objectShape(o, X, Y, selectedId))

  // 总尺寸标注
  const dimY = oy + siteH + 38
  const dimX = ox - 38
  parts.push(dimensionLine(ox, dimY, ox + siteW, dimY, `场地长 ${p.length.toFixed(0)} m`, { tickY: -8 }))
  parts.push(dimensionLine(dimX, oy, dimX, oy + siteH, `场地宽 ${p.width.toFixed(0)} m`, { rotateLabel: -90, tickX: 8 }))

  // 通道宽度标注，放在通道内部
  if (p.orientation === 'length') {
    const ax = X(-p.length * 0.36)
    const y1 = Y(-p.passageWidth / 2)
    const y2 = Y(p.passageWidth / 2)
    parts.push(dimensionLine(ax, y1, ax, y2, `通道宽 ${p.passageWidth.toFixed(1)}m`, { color: '#92400e', tickX: -7 }))
  } else {
    const ay = Y(-p.width * 0.36)
    const x1 = X(-p.passageWidth / 2)
    const x2 = X(p.passageWidth / 2)
    parts.push(dimensionLine(x1, ay, x2, ay, `通道宽 ${p.passageWidth.toFixed(1)}m`, { color: '#92400e', tickY: -7 }))
  }

  parts.push(textLabel(frame.x + 24, frame.y + frame.h - 18, '注：尺寸单位为米；M 记号表示该物件曾手动移动、旋转或缩放。', {
    anchor: 'start', size: 12, color: '#64748b', background: false
  }))

  // 右侧图签/清单
  const panelX = 922
  const panelW = 320
  const panelY = 92
  const panelH = height - 158
  parts.push(`<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="18" fill="#ffffff" stroke="#e2e8f0" filter="url(#plan-shadow)"/>`)
  parts.push(`<text x="${panelX + 24}" y="${panelY + 38}" font-size="20" font-weight="900" fill="#0f172a">现场交底清单</text>`)
  parts.push(`<line x1="${panelX + 22}" y1="${panelY + 54}" x2="${panelX + panelW - 22}" y2="${panelY + 54}" stroke="#e2e8f0"/>`)

  let yy = panelY + 82
  const infoLines = [
    `生成种子：${seed}`,
    `通道宽度：${p.passageWidth.toFixed(1)} m`,
    ...TYPE_ORDER.map((t) => `${TYPE_CONFIG[t].label}：${objects.filter((o) => o.type === t).length} ${TYPE_CONFIG[t].unit}`),
    ...TYPE_ORDER.map((t) => {
      const actual = pairMap[t] ? Math.max(0, pairMap[t].gap).toFixed(1) : TYPE_CONFIG[t].gap.toFixed(1)
      return `${TYPE_CONFIG[t].label}净距 ${actual}m（标准 ${TYPE_CONFIG[t].gap.toFixed(1)}m）`
    })
  ]
  for (const line of infoLines) {
    parts.push(`<circle cx="${panelX + 29}" cy="${yy - 4}" r="3.5" fill="#0ea5e9"/>`)
    parts.push(`<text x="${panelX + 42}" y="${yy}" font-size="13.5" fill="#334155" font-weight="650">${esc(line)}</text>`)
    yy += 25
  }

  yy += 12
  parts.push(`<text x="${panelX + 24}" y="${yy}" font-size="16" font-weight="900" fill="#b45309">手动调整物件（${manualObjects.length}）</text>`)
  yy += 22
  parts.push(`<line x1="${panelX + 22}" y1="${yy - 8}" x2="${panelX + panelW - 22}" y2="${yy - 8}" stroke="#fde68a"/>`)

  if (!manualObjects.length) {
    parts.push(`<text x="${panelX + 24}" y="${yy + 14}" font-size="13" fill="#64748b">暂无；所有物件均为自动排布。</text>`)
    yy += 46
  } else {
    manualObjects.slice(0, 70).forEach((o) => {
      const fields = manualFields(o).join('/')
      parts.push(`<rect x="${panelX + 22}" y="${yy}" width="${panelW - 44}" height="30" rx="8" fill="#fffbeb" stroke="#fde68a"/>`)
      parts.push(`<circle cx="${panelX + 38}" cy="${yy + 15}" r="7" fill="#f59e0b"/>`)
      parts.push(`<text x="${panelX + 38}" y="${yy + 18.5}" text-anchor="middle" font-size="9" font-weight="900" fill="#ffffff">M</text>`)
      parts.push(`<text x="${panelX + 52}" y="${yy + 19}" font-size="12.5" font-weight="800" fill="#78350f">${esc(o.label)} · ${esc(fields)}</text>`)
      yy += 36
    })
  }

  yy += 18
  const notes = ['主通道内禁止堆放；警戒桩封闭场地边界开口。', '同类物件按标注净距验收；手动位置以本图为准。', '现场负责人签字：____________　日期：____________']
  for (const note of notes) {
    const words = String(note)
    parts.push(`<text x="${panelX + 24}" y="${yy}" font-size="12.5" fill="#475569">${esc(words)}</text>`)
    yy += 28
  }

  // 指北针
  const nx = width - 82
  const ny = 54
  parts.push(`<g transform="translate(${nx} ${ny})"><circle r="24" fill="#ffffff" stroke="#cbd5e1"/><path d="M0,-17 L7,8 L0,4 L-7,8 Z" fill="#ef4444"/><text y="-29" text-anchor="middle" font-size="13" font-weight="900" fill="#0f172a">N</text></g>`)
  parts.push('</svg>')
  return parts.join('')
}
