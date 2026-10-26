import { parseBatteryDump as parseSharedBatteryDump } from '@yanjiu-scrcpy/shared'
/**
 * Parse ADB battery dump data into a structured object
 *
 * @param {string} dumpData - Raw battery dump data from ADB
 * @returns {Object} Parsed and normalized battery data
 *
 * // Example usage:
 * const dumpData = fs.readFileSync('battery-dump.txt', 'utf8');
 * const batteryInfo = parseBatteryDump(dumpData);
 * console.log(batteryInfo);
 *
 */
export function parseBatteryDump(dumpData) {
  return parseSharedBatteryDump(dumpData)
}
