// website/content/guide-seo.en.js
// English "search-facing wrapper" for the troubleshooting guides — see guide-seo.js
// for why this is separate from the knowledge base.
//
// ⚠ `slug` is intentionally NOT repeated here. The English page must live at the same
//    filename as the Korean one (dist/guide-x.html and dist/en/guide-x.html), because
//    hreflang pairs the two by URL. build.js takes the slug from the Korean file only.
//
// `related` points at the explainer articles (learn-*.html), which are Korean-only for
// now. Linking an English reader into a Korean page without warning wastes their click,
// so the English pages omit the "further reading" block until those are translated.

module.exports = {
  'MEMORY-MIXED-DIMM-BELOW-RATED': {
    pageTitle: 'Why mixing RAM modules lowers your memory speed',
    metaDesc: 'When memory of different makes or capacities is installed together, the board runs it at the lowest setting they share. How to check the current and rated speeds, and how to enable XMP/EXPO, step by step.',
    intro: 'You added memory, but nothing feels faster — or a diagnostic tool reports a speed below the rating. When modules of different specifications sit together, the motherboard picks <strong>the lowest setting at which all of them run reliably</strong>. That is compatibility behaviour, not a fault, but you are paying for it in performance.',
  },

  'MEMORY-BELOW-RATED-SPEED': {
    pageTitle: 'When RAM does not run at its rated speed (stuck at 2666 MHz and similar)',
    metaDesc: '3200 MHz memory reporting 2666 MHz is usually not a fault — XMP/EXPO is simply disabled in the BIOS. How to tell the causes apart, how to enable the profile, and how to undo it.',
    intro: 'You bought 3200 MHz memory and the system says 2133 or 2666. Nine times out of ten nothing is broken. Memory <strong>runs at JEDEC standard speeds by default</strong>, and the number on the box only appears once you enable the profile (XMP/EXPO) in the BIOS. You did not buy the wrong thing — you have not switched on the right thing yet.',
  },

  'MEMORY-ABOVE-RATED-SPEED': {
    pageTitle: 'When memory runs faster than its rating — what to check',
    metaDesc: 'Memory running above its stated rating means XMP/EXPO is applied or a manual setting is still in place. Not a fault in itself — here is why it is still worth confirming stability.',
    intro: 'Running above the rating is <strong>not a problem in itself</strong>. Usually it is XMP/EXPO doing its job, or someone raised it by hand in the BIOS. But if you do not remember setting it — especially on a second-hand machine — that is a previous owner’s setting still in place, and it is worth confirming once that the system is actually stable there.',
  },

  'MEMORY-SINGLE-CHANNEL': {
    pageTitle: 'When dual channel does not engage — checking your RAM slots',
    metaDesc: 'Two modules running in single channel means half the bandwidth. How to find the recommended slots on your motherboard (usually A2/B2) and reseat the modules.',
    intro: 'Installing two modules does not automatically give you dual channel. <strong>Put them side by side in the same channel and the system runs in single channel</strong>, at half the bandwidth. The difference is most noticeable on systems using integrated graphics. Moving a module to another slot fixes it — this one costs nothing.',
  },

  'CPU-BASE-CLOCK-MODIFIED': {
    pageTitle: 'How to tell whether a CPU is overclocked (checking a used PC)',
    metaDesc: 'A base clock higher than the stock specification means the BIOS has been changed. How to check this when you receive a second-hand PC, and how to restore defaults.',
    intro: 'This is worth checking the moment you receive a second-hand PC. If the previous owner overclocked it, that setting <strong>stays exactly where they left it</strong> until someone resets it. Overclocking is not a fault — but knowing what state the machine arrived in beats discovering it months later through reboots you cannot explain.',
  },

  'GPU-POWER-LIMIT-MODIFIED': {
    pageTitle: 'When the graphics card power limit differs from the default',
    metaDesc: 'A power limit reported by nvidia-smi that differs from the default means an overclocking utility or a previous owner’s profile is still applied. How to check it and how to restore it.',
    intro: 'Change the power limit with a utility such as MSI Afterburner and the value can <strong>survive as a profile that reapplies at every startup</strong>, even after you uninstall the program. A lowered limit means cooler but capped; a raised one, the opposite. If performance is below what you expected and you cannot see why, this is a fast place to look.',
  },

  'CONFIG-STABILITY-INVESTIGATION': {
    pageTitle: 'Narrowing down blue screens and reboots on an overclocked machine',
    metaDesc: 'When changed settings and WHEA errors or unexpected shutdowns appear together, they have to be treated as two separate questions. The order in which to revert settings and narrow down the cause.',
    intro: 'Changed settings plus hardware error events does <strong>not prove the two are connected</strong>. The overclock may be the cause; it may be an unrelated component; it may be a power supply that cannot keep up. Before buying parts on a guess, work through what can be undone, one item at a time, and narrow the range.',
  },

  'BATTERY-CAPACITY-DEGRADED': {
    pageTitle: 'When laptop battery life drops — reading the capacity and deciding',
    metaDesc: 'Once full charge capacity falls below 80% of the design capacity, the drop in runtime becomes obvious. How to read the real capacity and how to decide on a replacement.',
    intro: 'A battery is a consumable; it will lose capacity with time. The hard part is knowing <strong>how much loss is normal</strong>. A large loss with a low cycle count points at storage conditions rather than use; the reverse is ordinary degradation. You need both numbers together before you can judge.',
  },

  'BASELINE-IDLE-TEMP-RISE': {
    pageTitle: 'When your CPU runs hotter than it usually does',
    metaDesc: 'Same idle state, higher temperature than usual — it is residual heat, room temperature, or dust. How to rule them out in order.',
    intro: '“Is 60°C hot for a CPU?” is hard to answer, because the normal range depends on the parts and the environment. There is a question that can be answered, though — <strong>“is this hotter than this PC usually runs?”</strong> With a value recorded under the same conditions you have a comparison, and from there the cause can be narrowed down.',
  },

  'BASELINE-IDLE-MEMORY-RISE': {
    pageTitle: 'When memory usage is high with nothing open',
    metaDesc: 'Idle memory usage above your usual level means startup programs or resident services have accumulated. How to find them and clear them, in order.',
    intro: 'If memory is more than half full with nothing running, it is usually <strong>the programs you have installed over time sitting in the background</strong>. Individually small, collectively noticeable. Which ones grew, and when, is something you can only see by comparing against your usual value.',
  },
};
