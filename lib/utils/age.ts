export function ageInYears(birthDate: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - birthDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}
