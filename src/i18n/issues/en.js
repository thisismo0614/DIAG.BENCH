// src/i18n/issues/en.js
// English translation overlay for src/engine/issueDb.js.
//
// This file carries **prose only**. Risk levels, wizard screen targets, categories and
// versions stay in issueDb.js, because they are behaviour, not language — a translation
// must never be able to change how risky an action is.
//
// ⚠ Array lengths must match the Korean original exactly. `actions` and `wizard` are
//    zipped with the risk levels **by index**; if a translation drops one item, every
//    following action gets the wrong risk label. issueDb.js refuses to apply an overlay
//    whose shape does not match, and falls back to Korean for that entry — see
//    localizedEntry(). A test covers this.

module.exports = {
  'MEMORY-MIXED-DIMM-BELOW-RATED': {
    title: 'Mismatched memory modules are installed, and they are running at a conservative speed',
    detection: 'Module specifications (model / manufacturer / capacity / rated speed) differ, and the current speed is below the highest rated speed',
    symptoms: [
      'Reduced memory bandwidth may cost performance in games and heavy workloads',
      'Rarely, mixed configurations can lead to stability problems',
    ],
    causes: [
      'Modules of different specifications run at the lowest setting they share',
      'The memory profile (XMP/EXPO) is disabled in the BIOS',
      'The motherboard or CPU memory controller does not support that speed with this slot configuration',
    ],
    actions: [
      'Check your current memory settings and the available profiles (XMP/EXPO) in the BIOS',
      'Check the motherboard manual for the maximum speed supported with this slot configuration',
      'Record your current BIOS settings before enabling a profile',
      'Enable the memory profile in the BIOS (an incorrect setting can prevent the machine from booting)',
      'Where possible, using identical modules throughout is the most reliable fix',
    ],
    verification: 'After changing BIOS settings, run a full diagnosis again to confirm the operating speed increased, then run the RAM test on the Stability tab to confirm there are no errors.',
    wizard: [
      {
        title: 'Check the current memory configuration',
        detail: 'In the RAM section of the diagnosis, check which module sits in which slot, and what the current and rated speeds are.',
      },
      {
        title: 'Record the current BIOS settings',
        detail: 'Photograph or write down the present values before changing anything. You need to be able to go back.',
      },
      {
        title: 'Check stability at the current configuration first',
        detail: 'Run the RAM test before changing anything, so you have a reference point.',
      },
      {
        title: 'Enable the memory profile in the BIOS',
        detail: 'Reboot into the BIOS and turn on XMP/EXPO. If the machine will not boot, clear the CMOS to undo it.',
      },
      {
        title: 'Re-test',
        detail: 'Once it boots, run a full diagnosis again to confirm the speed increased and the RAM test reports no errors.',
      },
    ],
  },

  'MEMORY-BELOW-RATED-SPEED': {
    title: 'Memory is running below the rated speed of the modules',
    detection: 'All modules share the same specification, but the current speed is below their rated speed',
    symptoms: ['Reduced memory bandwidth may cost some performance'],
    causes: [
      'The memory profile (XMP/EXPO) is disabled in the BIOS, so the modules run at JEDEC defaults',
      'The limit of what the motherboard or CPU supports has been reached',
      'A board characteristic that lowers the speed ceiling when every slot is populated',
    ],
    actions: [
      'Check your current memory settings and the available profiles (XMP/EXPO) in the BIOS',
      'Check the motherboard manual for the maximum speed supported with this slot configuration',
      'Record your current BIOS settings before enabling a profile',
      'Enable the memory profile in the BIOS (an incorrect setting can prevent the machine from booting)',
    ],
    verification: 'After changing BIOS settings, run a full diagnosis again to confirm the operating speed increased, then run the RAM test on the Stability tab to confirm there are no errors.',
    wizard: [
      {
        title: 'Check the current memory configuration',
        detail: 'In the RAM section of the diagnosis, check the current speed against the rated speed.',
      },
      {
        title: 'Record the current BIOS settings',
        detail: 'Keep a record of the present values before changing them. You need to be able to go back.',
      },
      {
        title: 'Enable the memory profile in the BIOS',
        detail: 'Turn on XMP/EXPO. If the machine will not boot, clear the CMOS to undo it.',
      },
      {
        title: 'Confirm stability',
        detail: 'Run the RAM test to confirm the new setting produces no errors.',
      },
      {
        title: 'Re-test',
        detail: 'Run a full diagnosis again to confirm the speed change took effect.',
      },
    ],
  },

  'MEMORY-ABOVE-RATED-SPEED': {
    title: 'Memory is running above the rated speed of the modules (settings have been changed)',
    detection: 'The current operating speed is higher than the rated speed the modules report',
    symptoms: [
      'No symptoms by itself',
      'If pushed too far, it can lead to intermittent reboots or blue screens',
    ],
    causes: [
      'A memory profile such as XMP/EXPO is applied',
      'The memory speed was raised manually in the BIOS',
    ],
    actions: [
      'Confirm this was intended (on a second-hand PC, a previous owner may have changed it)',
      'Run the RAM test on the Stability tab to confirm the current setting produces no errors',
      'If it is unstable, disable the profile in the BIOS and return to defaults',
    ],
    verification: 'Run the RAM integrity test on the Stability tab and confirm zero errors, then check that WHEA errors are not accumulating in the Windows event log.',
    wizard: [
      {
        title: 'Confirm the setting was intended',
        detail: 'If you never changed it yourself, it may be a setting left by the previous owner of a second-hand PC.',
      },
      {
        title: 'Test stability at the current setting',
        detail: 'Run the RAM integrity test and see whether errors appear. If there are none, there is no need to change anything.',
      },
      {
        title: 'Check the event log',
        detail: 'Look for recent WHEA errors or unexpected restarts.',
      },
      {
        title: 'If unstable, return to defaults',
        detail: 'Disable the profile in the BIOS. Stability comes before performance.',
      },
      {
        title: 'Re-test',
        detail: 'Run a full diagnosis again to confirm the memory speed is what you intended and the RAM test reports no errors.',
      },
    ],
  },

  'MEMORY-SINGLE-CHANNEL': {
    title: 'Memory is installed in only one channel',
    detection: 'Two or more modules are installed, but all of them sit in the same channel',
    symptoms: ['Halved memory bandwidth can make a visible difference with integrated graphics and in games'],
    causes: ['The slot layout was not matched when the machine was assembled'],
    actions: [
      'Check the motherboard manual for the dual-channel slot layout (usually A2/B2)',
      'Power the machine down completely and move a module to the recommended slot',
    ],
    verification: 'After moving the module, run a full diagnosis again to confirm the memory is split across two channels.',
    wizard: [
      {
        title: 'Check the recommended slot layout',
        detail: 'Find the dual-channel slots in the motherboard manual (usually A2/B2).',
      },
      {
        title: 'Cut the power',
        detail: 'Shut down, unplug the cable, and drain the residual power.',
      },
      {
        title: 'Move the module',
        detail: 'Reseat it in the recommended slot. Press firmly until the clip clicks.',
      },
      {
        title: 'Re-test',
        detail: 'Run a full diagnosis again to confirm the memory is now split across two channels.',
      },
    ],
  },

  'CPU-BASE-CLOCK-MODIFIED': {
    title: 'The CPU base clock is higher than the stock specification (settings have been changed)',
    detection: 'The base clock reported by the system is higher than the stock clock indicated by the model name',
    symptoms: [
      'No symptoms by itself',
      'If pushed too far, it can lead to higher temperatures and intermittent reboots',
    ],
    causes: [
      'BCLK or the multiplier was raised manually in the BIOS',
      'The motherboard automatic overclocking feature is enabled',
    ],
    actions: [
      'Confirm this was intended (on a second-hand PC, it may be the previous owner’s setting)',
      'Run the CPU stress test on the Stability tab to confirm the current setting causes no problems',
      'If it is unstable, restore defaults in the BIOS (Load Optimized Defaults)',
    ],
    verification: 'After checking or changing the BIOS settings, run a full diagnosis again to see whether the reported base clock changed.',
    wizard: [
      {
        title: 'Confirm the setting was intended',
        detail: 'If you never changed it yourself, it may come from a previous owner or the board’s automatic overclocking feature.',
      },
      {
        title: 'Stress test at the current setting',
        detail: 'Use the CPU stress test to check temperature and stability. If nothing goes wrong, you can leave it as it is.',
      },
      {
        title: 'Record the current BIOS settings',
        detail: 'If you plan to revert, write down the present values first.',
      },
      {
        title: 'Restore defaults',
        detail: 'Apply Load Optimized Defaults in the BIOS.',
      },
      {
        title: 'Re-test',
        detail: 'Run a full diagnosis again to confirm the base clock has returned to the stock value.',
      },
    ],
  },

  'GPU-POWER-LIMIT-MODIFIED': {
    title: 'The GPU power limit differs from the default',
    detection: 'The current power limit reported by nvidia-smi differs from the default power limit',
    symptoms: [
      'Raised: more performance, but higher temperatures and power draw',
      'Lowered: cooler, but performance is capped',
    ],
    causes: [
      'The power limit was changed with an overclocking utility',
      'A profile set by a previous owner is still in place',
    ],
    actions: [
      'Confirm this was intended (on a second-hand PC, it may be the previous owner’s setting)',
      'Run the GPU stress test on the Stability tab to confirm the current setting causes no problems',
      'To restore the default, run nvidia-smi -pl <default> (requires administrator rights)',
    ],
    verification: 'After restoring the setting, run a full diagnosis again to confirm the power limit matches the default.',
    wizard: [
      {
        title: 'Confirm the setting was intended',
        detail: 'Check whether a utility such as MSI Afterburner is set to run at startup.',
      },
      {
        title: 'GPU stress test at the current setting',
        detail: 'Check temperature and stability.',
      },
      {
        title: 'Find the value to restore',
        detail: 'Read the default power limit from the diagnosis results.',
      },
      {
        title: 'Restore the power limit',
        detail: 'Run nvidia-smi -pl <default> from an administrator command prompt.',
      },
      {
        title: 'Re-test',
        detail: 'Run a full diagnosis again to confirm it now matches the default.',
      },
    ],
  },

  'CONFIG-STABILITY-INVESTIGATION': {
    title: 'Hardware error events are present on a machine whose settings have been changed',
    detection: 'A settings change (overclock/profile) was detected, and the recent event log contains WHEA errors, blue screens or unexpected shutdowns',
    symptoms: ['Intermittent reboots', 'Blue screens', 'Freezes that only occur during particular work'],
    causes: [
      'The system may not be fully stable at the changed settings',
      'A separate hardware fault unrelated to the settings',
      'Insufficient power supply capacity',
    ],
    actions: [
      'Temporarily restore the changed settings to defaults, then use the machine for a few days and see whether the same errors return',
      'Run the CPU, RAM and GPU stress tests on the Stability tab to see whether the errors reproduce at the current settings',
      'If the errors disappear, raise the settings back one step at a time to find where they return',
    ],
    verification: 'Restore defaults, use the machine for a few days, then run a full diagnosis again and confirm the error events are not increasing.',
    wizard: [
      {
        title: 'Record the current settings',
        detail: 'Write down the present settings before reverting. If they turn out not to be the cause, you will want them back.',
      },
      {
        title: 'Try to reproduce with stress tests',
        detail: 'See whether the errors reproduce at the current settings. If they do, the cause is much easier to narrow down.',
      },
      {
        title: 'Restore defaults',
        detail: 'Return the changed items to their default values.',
      },
      {
        title: 'Observe over several days',
        detail: 'Use the machine as you normally would and watch for the same errors. This step takes time.',
      },
      {
        title: 'Re-test and judge',
        detail: 'Run a full diagnosis again. If the errors stopped, the settings were likely the cause.',
      },
    ],
  },

  'BATTERY-CAPACITY-DEGRADED': {
    title: 'Battery capacity has fallen well below the design capacity',
    detection: 'Full charge capacity ÷ design capacity is below 80%',
    symptoms: [
      'Less runtime per charge',
      'The charge indicator drops suddenly',
      'The machine shuts down as soon as it is unplugged',
    ],
    causes: [
      'Natural degradation from accumulated charge cycles',
      'Prolonged use or storage in a hot environment',
      'Kept plugged in at 100% charge at all times',
    ],
    actions: [
      'Check the cycle count alongside the capacity to judge whether this is normal for the machine’s age',
      'If the manufacturer provides a battery diagnostic tool, run it too and compare the values',
      'If you mostly work plugged in, enable the charge limit feature (e.g. 80%) in the manufacturer’s utility',
      'If the runtime is no longer enough for how you use the machine, consider replacing the battery',
    ],
    verification: 'Charge the battery fully, then run the diagnosis again and confirm the full charge capacity reports the same value. After a replacement it should read close to 100% of the design capacity.',
    wizard: [
      {
        title: 'Check the current state',
        detail: 'Look at design capacity, full charge capacity and cycle count together. A large capacity loss with few cycles points to something else, such as heat exposure.',
      },
      {
        title: 'Charge fully, then measure again',
        detail: 'Charge to 100% and run the diagnosis again. Full charge capacity can be under-reported when the battery is not full.',
      },
      {
        title: 'Compare with the manufacturer tool',
        detail: 'Compare against the battery reading from your laptop manufacturer’s utility and see whether both tools agree.',
      },
      {
        title: 'Adjust charging habits',
        detail: 'If you mostly work plugged in, enable the charge limit feature to slow further degradation.',
      },
      {
        title: 'Re-test',
        detail: 'After a few weeks of use, run the diagnosis again to see whether the capacity is still falling.',
      },
    ],
  },

  'BASELINE-IDLE-TEMP-RISE': {
    title: 'Idle temperature is higher than usual',
    detection: 'At the same idle state, the temperature is significantly above the recorded baseline',
    symptoms: ['Louder fans', 'Throttling sets in sooner under load'],
    causes: [
      'The room is warmer than when the baseline was recorded (season, air conditioning)',
      'Residual heat from heavy work done just before the measurement',
      'Dust on the heatsink and fans has reduced cooling performance',
      'Thermal paste has degraded, or the cooler mounting has shifted',
    ],
    actions: [
      'Leave the machine idle for a few minutes and measure again to rule out residual heat',
      'Open the case, remove dust from the heatsink and fans, then measure again',
      'If the room temperature differs a lot from when the baseline was taken, record a new baseline',
    ],
    verification: 'After removing the dust, leave the PC idle for a few minutes and run a full diagnosis again to confirm the gap against the baseline has narrowed.',
    wizard: [
      {
        title: 'Rule out residual heat',
        detail: 'Leave the PC alone for at least five minutes and measure again. If it was residual heat from earlier work, it disappears at this step.',
      },
      {
        title: 'Check the room temperature',
        detail: 'A different season or air-conditioning state than when the baseline was taken accounts for roughly 10°C on its own.',
      },
      {
        title: 'Remove dust',
        detail: 'Power down, open the case, and clear dust from the heatsink and fans.',
      },
      {
        title: 'Re-test',
        detail: 'Run a full diagnosis again to confirm the gap against the baseline has narrowed.',
      },
      {
        title: 'If it is still high, re-record the baseline',
        detail: 'If the environment itself has changed, record the present state as the new baseline.',
      },
    ],
  },

  'BASELINE-IDLE-MEMORY-RISE': {
    title: 'Idle memory usage is higher than usual',
    detection: 'At the same idle state, memory usage is significantly above the recorded baseline',
    symptoms: ['Switching between programs feels slower', 'More disk swapping as available memory runs short'],
    causes: [
      'More startup and background-resident programs than before',
      'A program that is not releasing memory is running',
      'A resident service belonging to software installed after the baseline was recorded',
    ],
    actions: [
      'In Task Manager, first identify which programs are using the most memory',
      'Disable unnecessary entries under Task Manager → Startup apps',
      'Identify resident programs with high memory usage and close them',
      'After cleaning up, record a new baseline to capture the new normal',
    ],
    verification: 'Clean up the resident programs, reboot, then run a full diagnosis again to confirm idle usage has moved back towards the baseline.',
    wizard: [
      {
        title: 'Identify the heaviest programs',
        detail: 'Look at the top memory-consuming processes in Task Manager.',
      },
      {
        title: 'Clean up startup apps',
        detail: 'Turn off entries you do not use under Task Manager → Startup apps.',
      },
      { title: 'Reboot', detail: 'Apply the changes.' },
      {
        title: 'Re-test',
        detail: 'Run a full diagnosis again to confirm idle usage has come down.',
      },
      {
        title: 'Re-record the baseline if needed',
        detail: 'Record the cleaned-up state as the new normal.',
      },
    ],
  },
};
