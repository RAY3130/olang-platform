'use strict';

/**
 * Assistant entry copy for the image/assistant optimisation round.
 * Kept separate from the presentation round so the action language and one-time nudge are
 * explicit and easy to roll back.
 */
module.exports = {
  en: {
    assistant: {
      open: 'Ask a product question',
      openShort: 'Ask',
      nudge: 'Ask about finish, size or MOQ',
    },
  },
  de: {
    assistant: {
      open: 'Fragen: Produktfrage stellen',
      openShort: 'Fragen',
      nudge: 'Frage zu Oberfläche, Maß oder MOQ',
    },
  },
  ja: {
    assistant: {
      open: '製品について質問',
      openShort: '質問',
      nudge: '仕上げ・寸法・MOQについて質問できます',
    },
  },
};
