export const DEFAULT_LOOK_SPEED = 1.75
export const LOOK_SPEED = { min: .75, max: 3, radiansPerPixel: .002, pitchLimit: Math.PI / 2 - .025 }
export function walkthroughLook(yaw: number, pitch: number, dx: number, dy: number, speed = DEFAULT_LOOK_SPEED): [number, number] {
  const multiplier = Math.max(LOOK_SPEED.min, Math.min(LOOK_SPEED.max, Number.isFinite(speed) ? speed : DEFAULT_LOOK_SPEED))
  return [yaw - dx * LOOK_SPEED.radiansPerPixel * multiplier,
    Math.max(-LOOK_SPEED.pitchLimit, Math.min(LOOK_SPEED.pitchLimit, pitch - dy * LOOK_SPEED.radiansPerPixel * multiplier))]
}
