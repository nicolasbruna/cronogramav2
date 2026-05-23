export function timeToMin(t: string): number {
  const parts = t.split(':')
  return parseInt(parts[0]) * 60 + parseInt(parts[1])
}

export function minToTime(m: number): string {
  m = Math.round(m)
  m = ((m % 1440) + 1440) % 1440
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}

export function formatDuration(min: number): string {
  min = Math.max(0, Math.round(min))
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return m + ' min'
  if (m === 0) return h + 'h'
  return h + 'h ' + String(m).padStart(2, '0') + 'min'
}

export function isLightColor(hex: string): boolean {
  if (!hex) return false
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 175
}

export function getDiaSemanaHoy(): number {
  const now = new Date()
  return now.getDay()
}
