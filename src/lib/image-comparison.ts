export interface ComparisonFrame {
  id: string
  detector: string
  band: string
  release: string
  time: number
  overlaps: boolean
  validPixels: number
  astrometricResidualPixels: number
}

export interface MotionOffset {
  dxPixels: number
  dyPixels: number
}

export interface ValidatedComparison {
  first: ComparisonFrame
  second: ComparisonFrame
  registrationSigmaPixels: number
  motionOffset?: MotionOffset
}

export type ComparisonResult = { available: true; value: ValidatedComparison } | { available: false; reason: string }

export function validateComparisonPair(
  first: ComparisonFrame,
  second: ComparisonFrame,
  maxAstrometricResidualPixels = 0.25,
): ComparisonResult {
  if (first.id === second.id) return { available: false, reason: 'Image comparison requires two distinct observations.' }
  if (first.detector !== second.detector || first.band !== second.band || first.release !== second.release) {
    return { available: false, reason: 'Images must share detector, channel, and processing release.' }
  }
  if (!first.overlaps || !second.overlaps) return { available: false, reason: 'Images do not have a validated overlapping footprint.' }
  if (!Number.isInteger(first.validPixels) || !Number.isInteger(second.validPixels) || first.validPixels <= 0 || second.validPixels <= 0) {
    return { available: false, reason: 'Images do not contain valid pixels for comparison.' }
  }
  const residual = Math.max(first.astrometricResidualPixels, second.astrometricResidualPixels)
  if (!Number.isFinite(residual) || residual < 0 || residual > maxAstrometricResidualPixels) {
    return { available: false, reason: `Astrometric residual exceeds the ${maxAstrometricResidualPixels}-pixel comparison limit.` }
  }
  return {
    available: true,
    value: {
      first,
      second,
      registrationSigmaPixels: Math.max(residual, Number.EPSILON),
    },
  }
}

export function withMotionOffset(comparison: ValidatedComparison, offset: MotionOffset): ValidatedComparison {
  if (!Number.isFinite(offset.dxPixels) || !Number.isFinite(offset.dyPixels)) {
    throw new Error('motion offset must contain finite pixel values')
  }
  return { ...comparison, motionOffset: offset }
}

export function differenceSignificance(
  difference: number,
  varianceFirst: number,
  varianceSecond: number,
  registrationSigmaPixels: number,
  localGradient: number,
): number {
  const registrationVariance = (registrationSigmaPixels * localGradient) ** 2
  const denominator = Math.sqrt(varianceFirst + varianceSecond + registrationVariance)
  if (![difference, varianceFirst, varianceSecond, registrationSigmaPixels, localGradient].every(Number.isFinite)
    || varianceFirst < 0 || varianceSecond < 0 || registrationSigmaPixels < 0 || localGradient < 0
    || denominator <= 0) {
    throw new Error('difference significance inputs must be finite and produce positive variance')
  }
  return difference / denominator
}
