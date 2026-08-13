// src/i18n/strings/en.js
// English. Mirrors the key structure of ko.js exactly — a test enforces this.

module.exports = {
  risk: {
    SAFE: 'Safe — inspection only',
    LOW: 'Low — easy to undo',
    INTERMEDIATE: 'Moderate — changes BIOS settings',
    ADVANCED: 'High — manual voltage/clock adjustment',
    EXPERT: 'Very high — hard to recover if it goes wrong',
  },

  wizardBackupWarning:
    'Some steps in this procedure are hard to undo. Before you start, record your current '
    + 'settings — a photo or a note is enough. An incorrect BIOS setting can leave the machine '
    + 'unable to boot; clearing the CMOS restores it.',

  // Shown when a piece of content has no translation yet and the Korean original is displayed.
  // Showing Korean text without saying so reads as a broken screen.
  untranslatedNotice:
    'This section has not been translated yet and is shown in the original Korean.',
};
