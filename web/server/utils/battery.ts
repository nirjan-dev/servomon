// Low-battery alert rule, kept pure so it can be unit-tested.
//
// The agent forwards systeminformation's battery percent, which is 0 on a
// machine without a battery, so 0 means "no battery", not "empty". (A running
// machine that reads 0% has a dead battery on mains power, which a low-battery
// alert can't act on either.)
export function isLowBattery(charge: number, threshold: number): boolean {
  return charge > 0 && charge <= threshold;
}
