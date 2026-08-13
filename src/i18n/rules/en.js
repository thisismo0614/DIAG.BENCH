// src/i18n/rules/en.js
// English catalogue for the verdicts produced by src/engine/rules.js.
//
// Keyed by the `msg.id` attached at each mkIssue() call site. Values are either plain
// strings or functions of the measured values (`params`) captured at judgement time.
//
// ⚠ Two rules, enforced by src/engine/reportI18n.js and covered by tests:
//
//   1. `causes`, `actions` and `evidence` must have **exactly the same number of items**
//      as the Korean original. Evidence is the reason a verdict was reached; an entry
//      that silently disappears in translation changes the verdict in the reader's eyes.
//      A mismatch makes the whole issue fall back to Korean.
//
//   2. Nothing here can change severity, confidence or the wizard. This file carries
//      sentences, not judgement.
//
// Runtime messages coming from the OS or a worker (params.error, params.workerError)
// are interpolated as-is. They may be Korean — we do not have an English form of what
// Windows told us, and inventing one would be worse than showing the original.

// The Korean original composes some phrases before it builds the sentence (a date, a
// coverage description, a "A → B" range). Those arrive here as raw values, so the same
// phrases are rebuilt in English — passing the assembled Korean string through would
// leave Korean embedded in an English sentence.
function enDate(iso) {
  if (!iso) return 'an unknown date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'an unknown date'
    : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
}

function vramCoverage(p) {
  return p.coveredMB !== null && p.coveredMB !== undefined && p.totalMB
    ? `${Math.round(p.coveredMB)} MB of ${p.totalMB} MB total VRAM`
    : `${Math.round(p.allocatedMB)} MB of allocated range (not confirmed to be real VRAM)`;
}

const range = (from, to, unit) => (from !== null && from !== undefined && to !== null && to !== undefined
  ? `${Math.round(from)}${unit} → ${Math.round(to)}${unit}`
  : null);
const tempRange = (p) => range(p.startTempC, p.endTempC, '°C');
const clockRange = (p) => range(p.startClockMHz, p.endClockMHz, ' MHz');

module.exports = {
  // ---------- CPU: temperature and load ----------
  'CPU-TEMP-CRITICAL': {
    title: 'CPU temperature is at a dangerous level',
    explanation: (p) => `The CPU is currently at ${p.tempC}°C, which is within the range where thermal throttling or a forced shutdown can occur.`,
    causes: [
      'Poorly mounted cooler or degraded thermal paste',
      'Insufficient case airflow',
      'Sustained heavy work (rendering, gaming)',
    ],
    actions: [
      'Re-check that the CPU cooler is properly seated',
      'Consider reapplying thermal paste',
      'Check the intake and exhaust direction of the case fans',
    ],
    evidence: (p) => [`Temperature ${p.tempC}°C (danger threshold: 95°C and above)`],
    verification: 'After making a change, run the CPU stress test again on the Stability tab and confirm the peak temperature came down.',
  },

  'CPU-TEMP-HIGH-UNDER-LOAD': {
    title: 'The CPU is running hot under heavy load',
    explanation: (p) => `At ${p.loadPercent}% load the temperature rose to ${p.tempC}°C. If it stays there, throttling becomes likely.`,
    causes: [
      'The air or liquid cooler is at the limit of its capacity',
      'High ambient temperature',
      'Dust reducing heatsink performance',
    ],
    actions: [
      'Keep a heavy workload running for a few minutes and watch the temperature trend',
      'Clear dust from inside the case',
      'Consider replacing the cooler if needed',
    ],
    evidence: (p) => [`Load ${p.loadPercent}%`, `Temperature ${p.tempC}°C`, 'Single-point measurement (trend not established)'],
    verification: 'Run the CPU stress test on the Stability tab for 15 seconds and check whether the temperature keeps climbing and whether the clock drops.',
  },

  'CPU-TEMP-ELEVATED': {
    title: 'CPU temperature is somewhat elevated',
    explanation: (p) => `At ${p.loadPercent}% load the temperature is ${p.tempC}°C. Not an immediate problem, but worth keeping an eye on.`,
    causes: [
      'Possibly just ordinary heavy work in progress',
      'Possibly a shrinking cooling margin',
    ],
    actions: ['No action is needed, but if it keeps rising, run the stress test to check'],
    evidence: (p) => [`Load ${p.loadPercent}%`, `Temperature ${p.tempC}°C`, 'Below the warning threshold (85°C) — not enough evidence to judge'],
    verification: 'If it feels hotter than usual, run the CPU stress test on the Stability tab and check the trend.',
  },

  'CPU-THERMAL-THROTTLING': {
    title: 'CPU thermal throttling is suspected',
    explanation: (p) => `With CPU usage continuously above 85%, the temperature rose from ${p.tempFrom}°C to ${p.tempTo}°C while the clock fell from ${p.clockFrom} GHz to ${p.clockTo} GHz.`,
    causes: [
      'Thermal limiting caused by insufficient cooling',
      'Prolonged heavy work in a hot environment',
      'A motherboard power limit setting',
    ],
    actions: [
      'Check case airflow (intake and exhaust)',
      'Re-check that the CPU cooler is properly seated',
      'Check the motherboard power limits (PL1/PL2)',
    ],
    evidence: ['Sustained heavy load confirmed', 'Rising temperature trend confirmed', 'Falling clock trend confirmed'],
    verification: 'Improve case airflow, then re-run the CPU stress test on the Stability tab and compare how far the clock drops.',
  },

  'CPU-TEMP-RISING-NO-THROTTLE': {
    title: 'CPU temperature is rising, but there is not yet evidence of throttling',
    explanation: (p) => `The temperature rose from ${p.tempFrom}°C to ${p.tempTo}°C, but the clock held at ${p.clockFrom} GHz → ${p.clockTo} GHz, so there is no clear sign of performance limiting.`,
    causes: [
      'A normal response to heavy load (not throttling yet)',
      'Throttling could follow if the temperature keeps rising',
    ],
    actions: ['Nothing needs doing right now — keep the same workload running for longer and watch the temperature'],
    evidence: ['Rising temperature confirmed', 'No clock drop observed — throttling verdict withheld'],
    verification: 'Run the CPU stress test on the Stability tab for longer (60 seconds, say) and check whether the temperature keeps rising and whether the clock still holds.',
  },

  'CPU-LOAD-VERY-HIGH': {
    title: 'CPU usage is persistently very high',
    explanation: (p) => `Load is currently ${p.loadPercent}%. The processes below are taking most of the CPU.`,
    causes: [
      'Too many background processes running',
      'A misbehaving process, such as one stuck in a loop',
      'Simply heavy work in progress',
    ],
    actions: [
      'Identify the processes with high CPU usage in Task Manager',
      'Clear out unnecessary startup programs',
    ],
    evidence: (p) => [`Load ${p.loadPercent}%`],
    verification: 'Close the suspect process, then run a full diagnosis again and confirm CPU load has returned to a normal range.',
  },

  // ---------- Memory ----------
  'MEM-USAGE-NEAR-LIMIT': {
    title: 'Memory usage is close to the limit',
    explanation: (p) => `${p.usedGB} GB of ${p.totalGB} GB (${p.usedPercent}%) is in use. The processes below are taking most of the memory.`,
    causes: [
      'Too many programs or browser tabs open at once',
      'A program leaking memory',
      'Not enough physical memory for the workload',
    ],
    actions: [
      'Close programs you are not using',
      'Identify the processes with high memory usage in Task Manager',
      'If this keeps happening, consider adding RAM',
    ],
    evidence: (p) => [`Memory usage ${p.usedPercent}%`, `Available memory ${p.availableGB} GB`],
    verification: 'Close some programs, then run a full diagnosis again and confirm usage came down.',
  },

  'MEM-SWAP-HIGH': {
    title: 'Virtual memory (swap) usage is high',
    explanation: 'Physical memory is short, so the system is leaning on disk-based virtual memory, which can slow things down.',
    causes: ['Not enough physical RAM'],
    actions: ['Run fewer programs at once', 'Consider adding RAM'],
    evidence: (p) => [`Swap ${p.swapUsedGB} GB of ${p.swapTotalGB} GB in use`],
    verification: 'Reboot, repeat the same work, and check the swap usage trend again.',
  },

  // ---------- CPU stress test ----------
  'CPU-STRESS-WORKER-ERROR': {
    title: 'The CPU stress test did not run properly',
    explanation: (p) => `A worker thread raised an error, so the test did not finish (${p.workerError || 'cause unknown'}). This result cannot tell you anything about CPU stability.`,
    causes: [
      'A temporary shortage of system resources',
      'Security software blocking thread creation',
    ],
    actions: ['Close other programs and try again'],
    evidence: ['Stress test failed to run — verdict withheld'],
    verification: 'Try running "Stability > CPU stress test" again.',
  },

  'CPU-STRESS-SAFETY-ABORT': {
    title: 'The CPU stress test stopped automatically at the safety temperature limit',
    explanation: (p) => `During the stress test the CPU reached the safety limit (${p.safetyTempC}°C) and the test stopped itself. Note that this test deliberately burns every core at once, so it does not mean everyday use reaches the same temperature.`,
    causes: [
      'Poorly mounted cooler or aged thermal paste',
      'CPU settings too aggressive for the cooler (overclock, power limits removed)',
      'Insufficient airflow inside the case',
    ],
    actions: [
      'Check that the cooler is making proper contact',
      'Clear dust from the heatsink and fans',
      'Watch the temperature with live monitoring during the work you actually do',
    ],
    evidence: (p) => [`Peak temperature during the stress test: ${p.maxTempC}°C`, `Stopped automatically on reaching the ${p.safetyTempC}°C safety limit`],
    verification: 'Clear the dust, then run the same stress test again and compare the peak temperature.',
  },

  'CPU-STRESS-CLOCK-DROP': {
    title: 'The CPU clock fell during the stress test',
    explanation: (p) => `During the test the CPU clock moved from ${p.maxClockGHz} GHz to ${p.minClockGHz} GHz, with a peak temperature of ${p.maxTempC}°C. This could be thermal limiting or ordinary power management, so no firm verdict is given.`,
    causes: [
      'Thermal throttling',
      'A motherboard power limit setting',
      'Normal turbo boost behaviour',
    ],
    actions: ['Clear the dust, re-test, and see whether the clock varies less'],
    evidence: (p) => [`Clock ${p.maxClockGHz} GHz → ${p.minClockGHz} GHz`, `Peak temperature ${p.maxTempC}°C`],
    verification: 'Improve cooling, repeat the same test, and compare whether the clock holds.',
  },

  // ---------- RAM integrity test ----------
  'RAM-TEST-MISMATCH': {
    title: (p) => `The RAM integrity test found ${Number(p.errors).toLocaleString('en-US')} mismatches`,
    explanation: (p) => `A pattern was written to a ${p.sizeMB} MB buffer and read back, and some values had changed`
      + `${p.firstErrorOffset !== null && p.firstErrorOffset !== undefined ? ` (first occurrence at byte ${Number(p.firstErrorOffset).toLocaleString('en-US')})` : ''}`
      + '. Seeing this from a software self-test is not normal.',
    causes: [
      'A faulty memory module',
      'An unstable memory overclock (XMP/EXPO)',
      'A bad slot or poor contact',
      'A problem with the CPU memory controller',
    ],
    actions: [
      'Back up important data first',
      'Turn off the memory overclock (XMP/EXPO) and test again',
      'Install one module at a time to find which one reproduces it',
      'Cross-check with a bootable test such as MemTest86',
    ],
    evidence: (p) => [
      `${Number(p.errors).toLocaleString('en-US')} mismatches`,
      `Test size ${p.sizeMB} MB`,
      `${p.patternsRun} patterns tested`,
    ],
    verification: 'Run at least one full pass with a bootable tool such as MemTest86 and confirm it reports the same thing.',
  },

  'RAM-TEST-INCOMPLETE': {
    title: 'The RAM integrity test did not finish',
    explanation: (p) => `The test did not run to completion (${p.error || 'cause unknown'}). This result cannot tell you anything about the state of the memory.`,
    causes: [
      'Could not reserve memory for the test (not enough RAM available)',
      'An error occurred during the test',
    ],
    actions: ['Close other programs and test again with a smaller size'],
    evidence: ['RAM test incomplete — verdict withheld'],
    verification: 'Close the programs you have running and try the test again.',
  },

  // ---------- Storage test ----------
  'STORAGE-TEST-VERIFY-MISMATCH': {
    title: 'What was written to the drive did not match what was read back',
    explanation: 'Content written to a temporary file did not match when it was read back. This is a data-corruption signal, and an entirely different matter from speed.',
    causes: [
      'A failing drive, or one near the end of its life',
      'A bad cable or controller contact',
      'File system damage',
    ],
    actions: [
      'Back up important data immediately',
      'Check the SMART status as well',
      'Replace the SATA cable or use a different port, then re-test',
      'Check the file system with chkdsk',
    ],
    evidence: ['Write/read data mismatch confirmed'],
    verification: 'After backing up, run the same test again and cross-check with the manufacturer’s diagnostic tool.',
  },

  'STORAGE-TEST-PRECHECK-FAILED': {
    title: 'The storage throughput test could not be run',
    explanation: (p) => `${p.error}. The test was skipped, so drive performance has not been established.`,
    causes: ['Not enough free space on the drive holding the temporary folder'],
    actions: ['Free up some files and run the test again'],
    evidence: ['Test not run — verdict withheld'],
    verification: 'Free up some space and try the test again.',
  },

  'STORAGE-TEST-IO-ERROR': {
    title: 'An error occurred while reading from or writing to the drive',
    explanation: (p) => `Something went wrong while writing or reading the test file (${p.errorStage || 'stage unknown'}: ${p.error || 'cause unknown'}). This is a different matter from slow throughput.`,
    causes: [
      'A problem with the drive',
      'Not enough free space',
      'A permissions problem, or security software blocking it',
      'A file system error',
    ],
    actions: [
      'Check the SMART status',
      'Free up space and re-test',
      'Check the file system with chkdsk',
    ],
    evidence: (p) => [`Failing stage: ${p.errorStage || 'unknown'}`, `Message: ${p.error || 'none'}`],
    verification: 'Free up space, turn security software off briefly, and try the test again.',
  },

  // ---------- Network ----------
  'NET-LATENCY-HIGH': {
    title: 'Network latency is high',
    explanation: (p) => `Average ping is ${p.avgMs} ms. You may notice the delay in online games or video calls.`,
    causes: [
      'Weak Wi-Fi signal',
      'Congestion on the ISP line',
      'Router performance, or distance from it',
    ],
    actions: [
      'Re-measure over a wired connection',
      'Restart the router',
      'Measure again at a different time of day to see whether it is the ISP',
    ],
    evidence: (p) => [`Average ping ${p.avgMs} ms`],
    verification: 'Connect by cable or restart the router, then measure ping again on the Internet speed test tab.',
  },

  'NET-JITTER-HIGH': {
    title: 'Network jitter (variation) is large',
    explanation: (p) => `Ping varies by ${p.jitterMs} ms, which is unstable. You may see intermittent stutter or lag.`,
    causes: [
      'Wi-Fi interference',
      'Bandwidth being used at the same time (downloads, streaming)',
    ],
    actions: [
      'Try a wired connection',
      'Check what else is downloading or streaming',
    ],
    evidence: (p) => [`Jitter ${p.jitterMs} ms`],
    verification: 'Stop downloads and streaming on other devices, run the Internet speed test again, and see whether jitter falls.',
  },

  'NET-PACKET-LOSS': {
    title: 'Packets are being lost',
    explanation: (p) => `About ${p.lossPercent}% of packets are being lost.`,
    causes: [
      'An unstable line',
      'A problem with the router or modem',
      'Wi-Fi interference',
    ],
    actions: [
      'Restart the router and modem',
      'Test over a wired connection',
      'Contact your ISP if it persists',
    ],
    evidence: (p) => [`Packet loss ${p.lossPercent}%`],
    verification: 'Restart the router, wait a few minutes, and measure again to see whether loss returns to 0%.',
  },

  // ---------- GPU: temperature, throttling, VRAM ----------
  'GPU-TEMP-CRITICAL': {
    title: 'GPU temperature is at a dangerous level',
    explanation: (p) => `The GPU is currently at ${p.tempC}°C.`,
    causes: ['A failed cooler or fan', 'Dust built up on the heatsink', 'Heat trapped inside the case'],
    actions: [
      'Look and confirm the GPU fans are actually spinning',
      'Open the case and see how the temperature changes',
      'Clear the dust',
    ],
    evidence: (p) => [`Temperature ${p.tempC}°C (danger threshold: 90°C and above)`],
    verification: 'Clear the dust, then run the same game or workload and confirm the GPU stays below 90°C.',
  },

  'GPU-TEMP-ELEVATED': {
    title: 'GPU temperature is somewhat elevated',
    explanation: (p) => `At ${p.loadPercent}% load the temperature is ${p.tempC}°C. This may be the normal range for this GPU model, so it is too early to call it a problem.`,
    causes: [
      'Possibly just ordinary heavy work in progress',
      'Possibly a cooling margin that is gradually shrinking',
    ],
    actions: ['No action is needed, but if it keeps rising, check the case airflow'],
    evidence: (p) => [`Load ${p.loadPercent}%`, `Temperature ${p.tempC}°C`, 'Below the danger threshold (90°C) — verdict withheld'],
    verification: 'Play the same game for 30 minutes or more, then run the diagnosis again and see whether the temperature approaches 90°C.',
  },

  'GPU-THERMAL-THROTTLING': {
    title: 'GPU thermal throttling is suspected',
    explanation: (p) => `With GPU usage continuously above 90%, the temperature rose from ${p.tempFrom}°C to ${p.tempTo}°C while the clock fell from ${p.clockFrom} MHz to ${p.clockTo} MHz.`,
    causes: [
      'Thermal limiting caused by insufficient cooling',
      'Prolonged heavy load in a hot environment',
    ],
    actions: [
      'Check case airflow (intake and exhaust)',
      'Check the GPU fan curve',
      'Clear dust from the heatsink and re-test',
    ],
    evidence: ['Sustained GPU load confirmed', 'Rising temperature trend confirmed', 'Falling clock trend confirmed', 'Performance may be reduced'],
    verification: 'Run the same game again with a full diagnosis and compare whether the temperature and clock trends improved.',
  },

  'GPU-TEMP-RISING-NO-THROTTLE': {
    title: 'GPU temperature is rising, but there is not yet evidence of throttling',
    explanation: (p) => `The temperature rose from ${p.tempFrom}°C to ${p.tempTo}°C, but the clock held at ${p.clockFrom} MHz → ${p.clockTo} MHz, so there is no clear sign of performance limiting.`,
    causes: [
      'A normal response to heavy load (not throttling yet)',
      'Throttling could follow if the temperature keeps rising',
    ],
    actions: ['Nothing needs doing right now — watch the temperature over a longer gaming session'],
    evidence: ['Rising temperature confirmed', 'No clock drop observed — throttling verdict withheld'],
    verification: 'Play the same game for longer, then run a full diagnosis again and check whether the clock still holds.',
  },

  'GPU-VRAM-NEAR-LIMIT': {
    title: 'VRAM usage is close to the limit',
    explanation: (p) => `${p.vramUsedMB} MB of ${p.vramTotalMB} MB of VRAM is in use.`,
    causes: [
      'Graphics settings too high for the amount of VRAM',
      'Several GPU-accelerated programs running at once',
    ],
    actions: [
      'Lower the graphics options (texture quality and so on)',
      'Close GPU-accelerated programs you are not using',
    ],
    evidence: (p) => [`VRAM usage ${Math.round((p.vramUsedMB / p.vramTotalMB) * 100)}%`],
    verification: 'Lower the graphics options and check VRAM usage again in the same scene.',
  },

  // ---------- VRAM integrity check (run separately from the renderer) ----------
  // 날짜·검사 범위는 원문에서 이미 한국어로 조립돼 있다. 여기서 원재료로 다시 조립한다.
  'VRAM-MISMATCH': {
    title: 'The VRAM integrity check found mismatches',
    explanation: (p) => `When data written into VRAM was read back and compared, ${Number(p.mismatchWords).toLocaleString('en-US')} words (4 bytes each) differed from what was written (checked ${enDate(p.checkedAt)}, ${vramCoverage(p)}). What was observed goes as far as "what was read differs from what was written" — this check alone cannot tell you whether the cause is a faulty VRAM cell or a driver problem.`,
    causes: [
      'A faulty VRAM cell',
      'A memory clock overclock pushed too far',
      'A graphics driver error',
      'Data corruption caused by GPU overheating',
    ],
    actions: [
      'If you overclocked the memory, return it to default and check again',
      'Switch the graphics driver to the latest or the last stable version and check again',
      'If the same result repeats, have the GPU serviced',
    ],
    evidence: (p) => [
      `${Number(p.mismatchWords).toLocaleString('en-US')} mismatched words`,
      `Coverage: ${vramCoverage(p)}`,
    ],
    verification: 'Run "Stability > VRAM stress and integrity test" once more and see whether the same result reproduces. A mismatch seen only once may have been transient.',
  },

  'VRAM-CONTEXT-LOST': {
    title: 'The graphics context was lost during the VRAM test',
    explanation: (p) => `The VRAM test run on ${enDate(p.checkedAt)} lost its graphics context partway through. This is what you see when the graphics driver resets (TDR).`,
    causes: [
      'The graphics driver stopped responding (TDR)',
      'Not enough VRAM',
      'Unstable power delivery',
      'A GPU hardware fault',
    ],
    actions: [
      'Reinstall the graphics driver',
      'Close every other GPU-using program and test again',
      'Check the Display errors in the Windows event log',
    ],
    evidence: ['Graphics context lost during the VRAM test'],
    verification: 'Run the VRAM test again and see whether it repeats at the same point.',
  },

  // ---------- GPU stress test ----------
  'GPU-STRESS-THROTTLE': {
    title: 'The stress test confirmed GPU thermal throttling',
    explanation: (p) => `In the peak-load section of the GPU stress test run on ${enDate(p.checkedAt)}, the temperature rose (${tempRange(p) || 'no measurement'}) while the clock fell (${clockRange(p) || 'no measurement'}). These values come from a load we applied deliberately, so they reproduce more reliably than catching a moment of incidental load.`,
    causes: [
      'Insufficient cooling (a fan not spinning properly, dust on the heatsink)',
      'Insufficient airflow inside the case',
      'Aged thermal pads or paste',
    ],
    actions: [
      'Look and confirm the GPU fans actually spin under load',
      'Check the case intake and exhaust fans',
      'Clear dust from the heatsink and re-run the same stress test',
    ],
    // ⚠ 근거 줄 수가 1~3줄로 달라진다. 원문과 같은 조건을 써야 개수가 맞는다.
    evidence: (p) => [
      `Peak temperature ${p.maxTempC !== null && p.maxTempC !== undefined ? `${Math.round(p.maxTempC)}°C` : 'not measurable'}`,
      ...(tempRange(p) ? [`Temperature at peak load ${tempRange(p)}`] : []),
      ...(clockRange(p) ? [`Clock at peak load ${clockRange(p)}`] : []),
    ],
    verification: 'After clearing dust or changing the fan settings, run "Stability > GPU stress test" again and compare whether the clock holds through the same section.',
  },

  'GPU-STRESS-SAFETY-ABORT': {
    title: 'The GPU stress test stopped automatically at the safety temperature limit',
    explanation: (p) => `During the test on ${enDate(p.checkedAt)} the GPU reached the safety limit (${p.safetyTempC !== null && p.safetyTempC !== undefined ? Math.round(p.safetyTempC) : 90}°C) and the test stopped itself. Note that this test applies a heavier load than a real game, so it does not mean everyday use reaches the same temperature.`,
    causes: [
      'Insufficient cooling',
      'A hot room',
      'A GPU model that simply runs hot by design',
    ],
    actions: [
      'Run the same test with the case open and compare the difference',
      'Check the fan curve settings',
      'Watch the temperature with live monitoring in the games you actually play',
    ],
    evidence: (p) => [
      `Peak temperature during the stress test ${p.maxTempC !== null && p.maxTempC !== undefined ? `${Math.round(p.maxTempC)}°C` : 'not measurable'}`,
      'Stopped automatically on reaching the safety limit',
    ],
    verification: 'Watch the temperature with live monitoring while running a game you actually play, and compare whether it climbs as high as the stress test did.',
  },

  // ---------- Storage volumes ----------
  'STORAGE-VOLUME-FULL': {
    title: (p) => `Drive ${p.mount} is running out of free space`,
    explanation: (p) => `${p.usedGB} GB of ${p.sizeGB} GB (${p.usePercent}%) is in use.`,
    causes: [
      'Accumulated unnecessary files and caches',
      'More installed software than the drive comfortably holds',
    ],
    actions: [
      'Run the disk cleanup tool',
      'Back up large files and delete them',
    ],
    evidence: (p) => [`Usage ${p.usePercent}%`],
    verification: 'After clearing space, run a full diagnosis again and confirm usage dropped below 90%.',
  },

  // ---------- SMART: overall health ----------
  'SMART-HEALTH-FAILED': {
    title: (p) => `Storage device (${p.device}): SMART reports a fault`,
    explanation: 'The SMART self-assessment returned something other than PASSED. There is a risk of data loss.',
    causes: ['The drive is physically worn or faulty'],
    actions: ['Back up important data immediately', 'Consider replacing the drive'],
    evidence: ['SMART self-assessment result: FAILED'],
    verification: 'After backing up, cross-check the SMART status once more with the manufacturer’s diagnostic tool.',
  },

  'SMART-HEALTH-UNKNOWN': {
    title: (p) => `Storage device (${p.device}): the SMART status could not be determined`,
    explanation: 'smartctl responded, but PASSED/FAILED could not be read reliably from the output. This device is not being called healthy or faulty. On Windows it is common for SMART to be unreadable without administrator rights.',
    causes: [
      'A device that cannot be opened without administrator rights (the most common cause)',
      'Differences in SMART output format on some SSDs and RAID controllers',
      'A USB-to-SATA bridge that does not pass SMART through',
    ],
    actions: [
      'Try again with administrator rights',
      'If that does not work, check directly with the manufacturer’s own SSD utility',
    ],
    evidence: ['smartctl output could not be interpreted'],
  },

  'SMART-TOOL-UNAVAILABLE': {
    title: 'The SMART status could not be checked',
    explanation: 'smartctl could not be run, so the drive’s SMART self-assessment was not read. This does not mean there is anything wrong with the drive — only that the tool could not be started.',
    causes: ['The bundled smartctl executable could not be found or run (possibly a damaged installation), or the OS is unsupported'],
    actions: ['Try reinstalling the app. If it persists, installing smartmontools (smartctl) yourself also works'],
    evidence: ['smartctl failed to run'],
  },

  // ---------- SMART: individual attributes ----------
  // 대기 중 섹터는 "읽기에 실패해 재할당을 기다리는 중"이라 가장 강한 조기 신호다.
  'SMART-PENDING-SECTORS': {
    title: (p) => `${p.label}: ${p.count} sector(s) failed to read (pending sectors)`,
    explanation: (p) => `The overall SMART assessment still says PASSED, but ${p.count} sector(s) failed to read and are waiting to be reallocated. This value is known to rise before a drive fails outright, so it warns you earlier than the overall assessment does.`,
    causes: [
      'Degradation of the disk surface or cells',
      'Unstable power during a read',
      'Read failures caused by poor cable contact',
    ],
    actions: [
      'Back up important data right now',
      'After backing up, run a full surface scan (chkdsk /r or the manufacturer’s tool)',
      'Replace the drive if the count keeps growing',
    ],
    evidence: (p) => [
      `Current_Pending_Sector: ${p.count}`,
      `Overall SMART assessment: ${p.status === 'passed' ? 'PASSED (but an attribute is signalling a problem)' : p.status}`,
    ],
    verification: 'Back up, run a surface scan, then re-run the diagnosis in a few days and compare whether the pending sector count has grown. If it has, the drive needs replacing.',
  },

  'SMART-UNCORRECTABLE-SECTORS': {
    title: (p) => `${p.label}: ${p.count} sector(s) could not be corrected`,
    explanation: 'These sectors could not be corrected even during an offline scan. The data held there may already be lost.',
    causes: ['Physical damage to the drive', 'End of service life'],
    actions: ['Back up important data immediately', 'Prepare to replace the drive'],
    evidence: (p) => [`Offline_Uncorrectable: ${p.count}`],
    verification: 'Once the backup is done, cross-check with the manufacturer’s diagnostic tool.',
  },

  'SMART-REALLOCATED-SECTORS': {
    title: (p) => `${p.label}: ${p.count} sector(s) have been reallocated`,
    explanation: (p) => 'These are sectors judged bad and moved to the spare area. '
      + (p.many
        ? 'The count is not small, so degradation may be under way.'
        : 'A handful of reallocations is not unusual on a drive in use, and does not by itself mean failure. What matters is whether the count grows.'),
    causes: ['Surface degradation (including the natural progression that comes with use)'],
    actions: [
      'Check that your backups of important data are current',
      'Re-run the diagnosis every few weeks and watch whether the count grows',
    ],
    evidence: (p) => [`Reallocated_Sector_Ct: ${p.count}`],
    verification: 'Re-run the diagnosis in a few weeks and compare the reallocated sector count. The trend is the key evidence for a replacement decision.',
  },

  'SMART-REPORTED-UNCORRECT': {
    title: (p) => `${p.label}: ${p.count} uncorrectable error(s) reported`,
    explanation: 'This is how many times the drive reported an error it could not correct itself. It is known to be a strong predictor of failure.',
    causes: ['Drive degradation', 'A controller or firmware problem'],
    actions: ['Back up important data', 'Track whether the value grows'],
    evidence: (p) => [`Reported_Uncorrect: ${p.count}`],
    verification: 'Re-run the diagnosis in a few days and check whether the value has increased.',
  },

  // CRC는 디스크가 아니라 대개 케이블 문제다. 같은 심각도로 다루면 멀쩡한 디스크를 버리게 된다.
  'SMART-CRC-ERRORS': {
    title: (p) => `${p.label}: ${p.count} data transfer error(s) (CRC)`,
    explanation: 'These errors happened in transit between the drive and the motherboard. **They point at the cable or the connection far more often than at the drive itself.** The value is cumulative, so it may be left over from something that happened once in the past.',
    causes: [
      'A faulty or loose SATA cable',
      'Poor contact on the power cable',
      'A problem with the motherboard port',
    ],
    actions: [
      'Swap the SATA cable and use a different port (the most common fix)',
      'If the value stops growing after the swap, the cable was the problem',
    ],
    evidence: (p) => [`UDMA_CRC_Error_Count: ${p.count}`, 'This attribute reflects the connection, not the life of the drive'],
    verification: 'Replace the cable, use the machine for a few days, then re-run the diagnosis and confirm the value has not grown further.',
  },

  // ---------- SSD wear ----------
  'SMART-SPARE-BELOW-THRESHOLD': {
    title: (p) => `${p.label}: the spare area has fallen below the threshold`,
    explanation: (p) => `Available spare blocks are at ${p.percent}%, at or below the manufacturer’s threshold of ${p.threshold}%. This signals that the SSD has reached the end of its life.`,
    causes: ['The SSD write endurance is exhausted', 'Accumulated bad blocks'],
    actions: ['Back up important data immediately', 'Prepare to replace the SSD'],
    evidence: (p) => [`Available Spare ${p.percent}% (threshold ${p.threshold}%)`],
    verification: 'Back up, cross-check with the manufacturer’s tool, and go ahead with the replacement.',
  },

  'SMART-WEAR-HIGH': {
    title: (p) => `${p.label}: ${p.percentUsed}% of the write endurance has been used`,
    explanation: (p) => (p.over
      ? 'The drive has used all of the write endurance the manufacturer warrants. That does not mean it will fail immediately, but you are past the warranted range, so it is worth backing up more often.'
      : 'The drive is approaching the manufacturer’s warranted write endurance. Still within normal operation, but worth watching.'),
    causes: ['A high cumulative write volume (ordinary wear from use)'],
    // 배열 **전체**를 함수로 둔다. 원소 하나만 함수로 두면 검증기가 문자열이 아니라고
    // 판단해 이 이슈가 통째로 한국어로 떨어진다(실제로 그렇게 짰다가 잡았다).
    actions: (p) => [
      'Keep your backup interval short for important data',
      p.over ? 'Planning a replacement is recommended' : 'Check the endurance figure periodically',
    ],
    // ⚠ 근거 줄 수를 원문과 맞춘다. 누적 쓰기량이 없으면 원문도 한 줄이다.
    evidence: (p) => [
      `Percentage Used ${p.percentUsed}%`,
      ...(p.totalHostWritesTB !== null && p.totalHostWritesTB !== undefined
        ? [`Total host writes ${p.totalHostWritesTB} TB`] : []),
    ],
    verification: 'Re-run the diagnosis every few months and see how fast the endurance figure climbs.',
  },

  // ---------- NVMe self-reported warnings ----------
  'SMART-CRITICAL-WARNING': {
    title: (p) => `${p.label}: the drive is reporting a critical warning flag (${p.flag})`,
    explanation: 'The NVMe drive is reporting a critical condition about itself — for example spare area exhausted, temperature exceeded, degraded reliability, or a switch to read-only.',
    causes: ['Spare area exhausted', 'Temperature threshold exceeded', 'Degraded internal reliability'],
    actions: ['Back up important data immediately', 'Check the detailed status with the manufacturer’s tool'],
    evidence: (p) => [`Critical Warning ${p.flag}`],
    verification: 'After backing up, cross-check with the manufacturer’s diagnostic tool.',
  },

  'SMART-MEDIA-ERRORS': {
    title: (p) => `${p.label}: ${p.count} media/data integrity error(s) recorded`,
    explanation: 'These are data errors the drive could not correct. The value is cumulative; the trend is what matters.',
    causes: ['NAND cell degradation', 'A controller or firmware problem'],
    actions: ['Back up important data', 'Check for a firmware update', 'Track whether the value grows'],
    evidence: (p) => [`Media and Data Integrity Errors: ${p.count}`],
    verification: 'Re-run the diagnosis in a few days and check whether the value has grown.',
  },

  'SMART-FAILING-NOW': {
    title: (p) => `${p.label}: an attribute has fallen below the manufacturer’s threshold`,
    explanation: (p) => `${(p.failingNow || []).map((f) => f.name).join(', ')} ${(p.failingNow || []).length === 1 ? 'is' : 'are'} below the threshold set by the manufacturer. This is not our criterion — it is the drive maker’s own.`,
    causes: ['Degradation of whatever the attribute measures'],
    actions: ['Back up important data immediately', 'Prepare to replace the drive'],
    // 근거 줄이 실패한 속성 개수만큼 만들어진다 — 원문과 같은 배열을 돈다.
    evidence: (p) => (p.failingNow || []).map((f) => `${f.name} (ID ${f.id}) — below threshold`),
    verification: 'After backing up, cross-check with the manufacturer’s diagnostic tool.',
  },

  // ---------- Drivers ----------
  'DRIVER-ERROR-DEVICES': {
    title: 'Some device drivers are in an error state',
    explanation: (p) => `Devices reported as faulty by Device Manager: ${p.names || `${p.count} device(s)`}`,
    causes: [
      'A driver is missing or damaged',
      'A hardware connection problem',
    ],
    actions: [
      'Update or reinstall the driver from Device Manager',
      'Download the latest driver from the manufacturer',
    ],
    evidence: (p) => [`${p.count} device(s) in an error state`],
    verification: 'Reinstall the driver and confirm the warning icon is gone in Device Manager.',
  },
};
