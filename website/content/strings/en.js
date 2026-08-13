// website/content/strings/en.js
// English site chrome. Mirrors the key structure of ko.js — a test enforces this.
//
// Only the pages that genuinely exist in English are listed in `nav`. Linking to a
// Korean page from an English menu without saying so wastes the reader's click.

module.exports = {
  htmlLang: 'en',
  ogLocale: 'en_US',
  languageName: 'English',

  skipLink: 'Skip to content',
  navLabel: 'Main menu',
  footerNavLabel: 'Footer menu',
  languageNavLabel: 'Language',

  nav: {
    guides: 'Troubleshooting',
    learn: 'Explainers',
    userGuide: 'User guide',
    download: 'Download',
    faq: 'FAQ',
    github: 'GitHub',
  },

  footer: {
    product: 'Product',
    learn: 'Learn',
    useCases: 'Use cases',
    project: 'Project',
    legal: 'License · Policies',
    items: {
      download: 'Download',
      features: 'Features',
      faq: 'FAQ',
      guides: 'Troubleshooting guides',
      learnHub: 'Explainers',
      userGuide: 'User guide',
      technical: 'Technical documentation',
      usedPc: 'Buying a used PC',
      repairShop: 'Repair shop intake',
      preDelivery: 'Pre-delivery inspection',
      verify: 'Verify a report',
      source: 'Source code',
      releases: 'Releases',
      issues: 'Report a bug',
      docs: 'Documentation',
      license: 'MIT License',
      thirdParty: 'Third-party notices',
      privacy: 'Privacy policy',
    },
  },

  copyright: (year, product) => `© ${year} ${product} · Open source (MIT)`,

  download: {
    label: 'Download for Windows',
    sub: (version, sizeMB, prerelease) =>
      `${version} · Windows x64 · ${sizeMB} MB${prerelease ? ' · pre-release' : ''}`,
    subNoRelease: 'Check the GitHub releases page for the latest version',
    versionLine: (version, date, prerelease) =>
      `Latest version <strong>${version}</strong> · released ${date}`
      + (prerelease ? ' · <strong>pre-release</strong> (comes before the stable build)' : ''),
    versionLineNoRelease: 'No public release yet',
    formatDate: (d) => d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
  },

  guide: {
    crumbsLabel: 'Breadcrumb',
    home: 'Home',
    guidesHub: 'Troubleshooting guides',
    eyebrow: (cat) => `${cat} troubleshooting`,
    detectionHeading: 'Check whether this is your problem',
    detectionLead: 'DIAG.BENCH reports this item when the following holds.',
    symptomsHeading: 'How it shows up',
    causesHeading: 'What can cause it',
    causesHint: 'Listed from most to least likely. Do not settle on one — narrow it down with the procedure below.',
    actionsHeading: 'Actions and their risk',
    actionsHint: 'Actions that only inspect come first. The harder something is to undo, the further down it sits.',
    riskyNotice: '<strong>Before you start.</strong> Some steps in this procedure are hard to undo.\n'
      + '         Record your current settings first — a photo or a note is enough. An incorrect BIOS\n'
      + '         setting can leave the machine unable to boot; clearing the CMOS on the motherboard restores it.',
    wizardHeading: 'Step-by-step procedure',
    verificationHeading: 'Confirm it is actually fixed',
    verificationNotice: 'Thinking you fixed it is only half of it — <strong>measure again under the same\n'
      + '         conditions and confirm the value really changed.</strong> If it did not, the cause lies elsewhere.',
    relatedHeading: 'Further reading',
    ctaHeading: 'Check this on your own PC',
    ctaLead: 'DIAG.BENCH tests the condition above automatically, and walks you through this procedure on screen when it applies.',
    // English pages are new, so the anchors can be readable ASCII from the start.
    anchors: {
      detection: 'detection', symptoms: 'symptoms', causes: 'causes', actions: 'actions',
      wizard: 'procedure', verification: 'verify', related: 'related',
    },
  },

  guidesHub: {
    eyebrow: 'Troubleshooting guides',
    h1: 'Narrowing down a cause, starting from the symptom',
    lead: (n) => `These are the ${n} items DIAG.BENCH actually judges.\n`
      + '      Each page gives you <strong>the condition that identifies the problem</strong>, the candidate\n'
      + '      causes, the actions with their risk marked, and a step-by-step procedure ordered so that\n'
      + '      you can still back out. They are written to be useful even without the program.',
    ctaHeading: 'Find out which of these applies to your PC',
    ctaLead: 'It tests every item above automatically and reports only the ones that apply, with the evidence.',
    title: 'Troubleshooting guides — DIAG.BENCH',
    desc: (n) => `Causes and step-by-step fixes, with risk levels, for ${n} common PC problems: memory speed, dual channel, traces of overclocking, battery degradation, rising idle temperature and more.`,
    listName: 'DIAG.BENCH troubleshooting guides',
  },

  categories: {
    RAM: 'Memory', CPU: 'CPU', GPU: 'Graphics card', BATTERY: 'Battery',
    EVENTS: 'System events', STORAGE: 'Storage', NETWORK: 'Network',
  },

  risk: {
    SAFE: { text: 'Safe', hint: 'Inspection only. Nothing on the system is changed.' },
    LOW: { text: 'Low', hint: 'Easy to undo.' },
    INTERMEDIATE: { text: 'Moderate', hint: 'Changes BIOS settings. A mistake can prevent the machine from booting.' },
    ADVANCED: { text: 'High', hint: 'Manual voltage/clock adjustment.' },
    EXPERT: { text: 'Very high', hint: 'Hard to recover if it goes wrong.' },
  },

  // Shown in the footer of every English page. The rest of the site is Korean, and
  // saying so is better than letting a reader click into a language they cannot read.
  partialNotice: 'Only the troubleshooting guides are available in English so far. '
    + 'The rest of the site — downloads, the user guide and the technical documentation — '
    + 'is currently Korean only.',
};
