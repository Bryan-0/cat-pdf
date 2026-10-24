// Cat PDF — hand-drawn SVG cat library.
// All cats share one style: rounded shapes, orange tabby fur with deep-orange stripes,
// cream muzzle, mint-green eyes. Colours come from CSS classes (.c-fur, .c-stripe, ...)
// so they follow the light/dark theme.

/* ------------------------------------------------------------------ faces */

const EARS = {
  up: `<path class="c-fur" d="M18 46 L21 9 L45 28 Z"/><path class="c-fur" d="M82 46 L79 9 L55 28 Z"/>
       <path class="c-pink" d="M24 37 L25.5 19 L37 29 Z"/><path class="c-pink" d="M76 37 L74.5 19 L63 29 Z"/>`,
  droop: `<path class="c-fur" d="M17 50 L6 22 L40 31 Z"/><path class="c-fur" d="M83 50 L94 22 L60 31 Z"/>
          <path class="c-pink" d="M20 42 L13 27 L33 32 Z"/><path class="c-pink" d="M80 42 L87 27 L67 32 Z"/>`,
};

const EYES = {
  neutral: `<g class="eyes">
      <ellipse class="c-eye" cx="37" cy="53" rx="5.6" ry="6.6"/><ellipse class="c-eye" cx="63" cy="53" rx="5.6" ry="6.6"/>
      <g class="pupils"><ellipse class="c-pupil" cx="37" cy="53.6" rx="2.3" ry="5"/><ellipse class="c-pupil" cx="63" cy="53.6" rx="2.3" ry="5"/></g>
      <circle class="c-white" cx="38.8" cy="50.4" r="1.5"/><circle class="c-white" cx="64.8" cy="50.4" r="1.5"/>
    </g>`,
  happy: `<g class="eyes"><path class="c-ink" stroke-width="2.8" d="M31 55 q6 -8 12 0 M57 55 q6 -8 12 0"/></g>`,
  sleepy: `<g class="eyes"><path class="c-ink" stroke-width="2.6" d="M31 53 q6 5 12 0 M57 53 q6 5 12 0"/></g>`,
  sad: `<g class="eyes">
      <ellipse class="c-eye" cx="37" cy="55" rx="5.4" ry="6"/><ellipse class="c-eye" cx="63" cy="55" rx="5.4" ry="6"/>
      <ellipse class="c-pupil" cx="37" cy="56" rx="2.6" ry="4.2"/><ellipse class="c-pupil" cx="63" cy="56" rx="2.6" ry="4.2"/>
      <circle class="c-white" cx="38.6" cy="53" r="1.4"/><circle class="c-white" cx="64.6" cy="53" r="1.4"/>
      <path class="c-ink" stroke-width="2" d="M30 46 l11 -3 M70 46 l-11 -3"/>
      <path class="c-tear" d="M33 63 q-3 5 0 6.5 q3 -1.5 0 -6.5 z"/>
    </g>`,
  confused: `<g class="eyes">
      <ellipse class="c-eye" cx="37" cy="53" rx="6.4" ry="7.4"/><ellipse class="c-eye" cx="63" cy="54" rx="4.6" ry="5.2"/>
      <ellipse class="c-pupil" cx="37.6" cy="53.6" rx="2.6" ry="5.4"/><ellipse class="c-pupil" cx="63.4" cy="54.4" rx="2" ry="3.8"/>
      <circle class="c-white" cx="39.4" cy="50" r="1.6"/><circle class="c-white" cx="64.6" cy="52" r="1.2"/>
      <path class="c-ink" stroke-width="2" d="M29 43 q8 -5 15 -1 M57 47 l11 -2"/>
    </g>`,
  smug: `<g class="eyes">
      <ellipse class="c-eye" cx="37" cy="54" rx="5.6" ry="5"/><ellipse class="c-eye" cx="63" cy="54" rx="5.6" ry="5"/>
      <ellipse class="c-pupil" cx="38.5" cy="55" rx="2.2" ry="3.6"/><ellipse class="c-pupil" cx="64.5" cy="55" rx="2.2" ry="3.6"/>
      <path class="c-fur" d="M30.5 52 q6.5 -6 13 0 z M56.5 52 q6.5 -6 13 0 z"/>
      <path class="c-ink" stroke-width="2" d="M30.5 52.2 h13 M56.5 52.2 h13"/>
    </g>`,
};

const MOUTHS = {
  neutral: `<path class="c-ink" stroke-width="1.9" d="M50 67.5 v2.2 M50 69.7 q-3 4.2 -6.6 1.4 M50 69.7 q3 4.2 6.6 1.4"/>`,
  open: `<path class="c-ink" stroke-width="1.9" d="M50 67.5 v1.8"/><path class="c-mouth" d="M44.5 70 q5.5 9 11 0 z"/>`,
  sad: `<path class="c-ink" stroke-width="1.9" d="M50 67.5 v2.4 M44 76 q6 -6 12 0"/>`,
  wavy: `<path class="c-ink" stroke-width="1.9" d="M50 67.5 v2.2 M43 74 q2.4 -2.6 4.8 0 t4.8 0 t4.8 0"/>`,
  yawn: `<path class="c-ink" stroke-width="1.9" d="M50 67.5 v1.8"/><ellipse class="c-mouth yawn-mouth" cx="50" cy="75" rx="6" ry="7"/>`,
};

/**
 * A cat head in a 100x100 box.
 * mood: neutral | happy | sleepy | sad | confused | smug | yawn
 */
export function face(mood = 'neutral') {
  const ears = mood === 'sad' ? EARS.droop : EARS.up;
  const eyes = EYES[mood === 'yawn' ? 'neutral' : mood] || EYES.neutral;
  const mouth = { happy: MOUTHS.open, sad: MOUTHS.sad, confused: MOUTHS.wavy, yawn: MOUTHS.yawn }[mood] || MOUTHS.neutral;
  return `<g class="cat-face">
    <g class="ears">${ears}</g>
    <ellipse class="c-fur" cx="50" cy="57" rx="36" ry="31"/>
    <path class="c-stripe" stroke-width="3.4" d="M50 28 v9 M41 30 l2 7 M59 30 l-2 7 M14.5 54 h9 M15.5 62.5 l8 -1.2 M85.5 54 h-9 M84.5 62.5 l-8 -1.2"/>
    <ellipse class="c-cream" cx="42.6" cy="70" rx="9.6" ry="7.6"/><ellipse class="c-cream" cx="57.4" cy="70" rx="9.6" ry="7.6"/>
    ${eyes}
    <path class="c-pink" d="M45.6 63.4 Q50 61.2 54.4 63.4 L50 67.8 Z"/>
    ${mouth}
    <path class="c-ink whiskers" stroke-width="1.2" d="M33 69.5 l-19 -3.5 M33 73.5 l-19 2 M67 69.5 l19 -3.5 M67 73.5 l19 2"/>
    ${mood === 'confused' ? '<text class="c-q" x="84" y="22" font-size="22" font-weight="800">?</text>' : ''}
  </g>`;
}

/** Plain cat face SVG (logo, avatars). */
export function catFace(mood = 'neutral', cls = '') {
  return `<svg class="cat ${cls}" viewBox="0 0 100 92" aria-hidden="true" focusable="false">${face(mood)}</svg>`;
}

/* ------------------------------------------------------------- full cats */

/** Front-facing sitting cat, 120x140 box. Tail group has class "tail". */
function sittingBody(mood = 'neutral') {
  return `<g class="cat-sitting">
    <g class="tail">
      <path class="c-tail-o" d="M86 128 C 112 128, 118 104, 106 88"/>
      <path class="c-tail" d="M86 128 C 112 128, 118 104, 106 88"/>
      <path class="c-stripe" stroke-width="3" d="M101 124 l3 5 M110 112 l5 2 M111 99 l5 -1"/>
    </g>
    <path class="c-fur" d="M31 90 C 21 110, 21 133, 36 137 L84 137 C 99 133, 99 110, 89 90 Z"/>
    <ellipse class="c-cream" cx="60" cy="117" rx="15" ry="18"/>
    <path class="c-stripe" stroke-width="3" d="M27 108 q6 2.4 9 -2 M26 118 q6 2.4 9 -2 M93 108 q-6 2.4 -9 -2 M94 118 q-6 2.4 -9 -2"/>
    <g class="paws"><ellipse class="c-cream c-paw paw-l" cx="47" cy="135" rx="9.5" ry="5.5"/><ellipse class="c-cream c-paw paw-r" cx="73" cy="135" rx="9.5" ry="5.5"/></g>
    <g class="head" transform="translate(10 2)">${face(mood)}</g>
  </g>`;
}

export function catSitting(mood = 'neutral', cls = '') {
  return `<svg class="cat ${cls}" viewBox="0 0 125 142" aria-hidden="true" focusable="false">${sittingBody(mood)}</svg>`;
}

/** Curled-up sleeping cat for empty states. */
export function catSleeping(cls = '') {
  return `<svg class="cat cat-sleeping ${cls}" viewBox="0 0 170 104" aria-hidden="true" focusable="false">
    <ellipse class="c-shadow" cx="88" cy="98" rx="70" ry="5"/>
    <g class="breathe">
      <path class="c-fur" d="M30 76 C 30 44, 70 34, 104 38 C 140 42, 158 60, 152 82 C 148 96, 120 98, 86 97 C 52 96, 30 94, 30 76 Z"/>
      <path class="c-stripe" stroke-width="3.4" d="M84 40 q6 9 2 17 M102 40 q7 9 3 18 M120 45 q6 8 1 17 M136 54 q4 7 -1 14"/>
      <path class="c-tail-o" d="M150 84 C 150 100, 96 104, 62 96"/>
      <path class="c-tail" d="M150 84 C 150 100, 96 104, 62 96"/>
      <path class="c-stripe" stroke-width="3" d="M128 96 l2 -6 M112 98 l1 -6 M96 98.5 l0 -6"/>
    </g>
    <g transform="translate(8 34) scale(0.62)">
      <g class="ears">${EARS.up}</g>
      <ellipse class="c-fur" cx="50" cy="57" rx="36" ry="31"/>
      <path class="c-stripe" stroke-width="3.4" d="M50 28 v9 M41 30 l2 7 M59 30 l-2 7"/>
      <ellipse class="c-cream" cx="42.6" cy="70" rx="9.6" ry="7.6"/><ellipse class="c-cream" cx="57.4" cy="70" rx="9.6" ry="7.6"/>
      ${EYES.sleepy}
      <path class="c-pink" d="M45.6 63.4 Q50 61.2 54.4 63.4 L50 67.8 Z"/>
      <path class="c-ink" stroke-width="1.9" d="M50 67.8 v2 M50 69.8 q-3 3.6 -6 1.2 M50 69.8 q3 3.6 6 1.2"/>
    </g>
    <ellipse class="c-cream" cx="56" cy="94" rx="10" ry="5"/>
    <g class="zzz"><text class="c-z z1" x="66" y="30" font-size="14">z</text><text class="c-z z2" x="78" y="20" font-size="11">z</text><text class="c-z z3" x="88" y="12" font-size="8">z</text></g>
  </svg>`;
}

/** Cat peeking over an edge (place at top of a card). */
export function catPeeking(cls = '') {
  return `<svg class="cat cat-peek ${cls}" viewBox="0 0 100 52" aria-hidden="true" focusable="false">
    <g class="ears">${EARS.up}</g>
    <path class="c-fur" d="M14 52 C 14 30, 30 24, 50 24 C 70 24, 86 30, 86 52 Z"/>
    <path class="c-stripe" stroke-width="3.4" d="M50 27 v8 M41 29 l2 6.5 M59 29 l-2 6.5"/>
    <g class="eyes"><ellipse class="c-eye" cx="37" cy="44" rx="5.4" ry="6.2"/><ellipse class="c-eye" cx="63" cy="44" rx="5.4" ry="6.2"/>
      <ellipse class="c-pupil" cx="37.5" cy="44.6" rx="2.2" ry="4.8"/><ellipse class="c-pupil" cx="63.5" cy="44.6" rx="2.2" ry="4.8"/>
      <circle class="c-white" cx="39" cy="41.6" r="1.4"/><circle class="c-white" cx="65" cy="41.6" r="1.4"/></g>
    <ellipse class="c-cream c-paw" cx="27" cy="50.5" rx="9" ry="5"/><ellipse class="c-cream c-paw" cx="73" cy="50.5" rx="9" ry="5"/>
    <path class="c-ink" stroke-width="1.2" d="M23 48 v4 M27 47.5 v4.5 M31 48 v4 M69 48 v4 M73 47.5 v4.5 M77 48 v4"/>
  </svg>`;
}

/** A cat seen from behind with a swishing tail (sidebar footer). */
export function catFromBehind(cls = '') {
  return `<svg class="cat cat-behind ${cls}" viewBox="0 0 96 84" aria-hidden="true" focusable="false">
    <g class="swish">
      <path class="c-tail-o" d="M54 78 C 80 80, 86 58, 76 44 C 70 36, 80 26, 86 30"/>
      <path class="c-tail" d="M54 78 C 80 80, 86 58, 76 44 C 70 36, 80 26, 86 30"/>
      <path class="c-stripe" stroke-width="2.6" d="M74 76 l1 -5 M80 64 l-5 -1 M77 50 l-5 2"/>
    </g>
    <path class="c-fur" d="M22 80 C 10 66, 16 44, 30 38 C 40 34, 50 36, 56 44 C 66 58, 64 76, 54 80 Z"/>
    <path class="c-stripe" stroke-width="3" d="M24 52 q8 3 14 0 M20 62 q10 4 20 0 M22 72 q10 4 22 0"/>
    <path class="c-fur" d="M22 22 L24 4 L34 14 Z M48 22 L46 4 L36 14 Z"/>
    <ellipse class="c-fur" cx="35" cy="26" rx="16" ry="14"/>
    <path class="c-stripe" stroke-width="2.6" d="M35 14 v8 M28 15.5 l1.5 6 M42 15.5 l-1.5 6"/>
  </svg>`;
}

/** Paw print (uses currentColor). */
export function paw(cls = '') {
  return `<svg class="paw ${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="currentColor">
    <path d="M16 15c-4.5 0-9 5.2-9 9.2 0 2.6 2.2 3.6 4.4 3.1 1.7-.4 3-.9 4.6-.9s2.9.5 4.6.9c2.2.5 4.4-.5 4.4-3.1 0-4-4.5-9.2-9-9.2z"/>
    <ellipse cx="6.5" cy="13" rx="2.9" ry="3.8" transform="rotate(-20 6.5 13)"/><ellipse cx="12" cy="7.2" rx="3" ry="4"/>
    <ellipse cx="20" cy="7.2" rx="3" ry="4"/><ellipse cx="25.5" cy="13" rx="2.9" ry="3.8" transform="rotate(20 25.5 13)"/></g></svg>`;
}

/* ------------------------------------------------------- loader scenes */

const YARN = `<g class="yarn-ball"><circle class="c-yarn" cx="0" cy="0" r="14"/>
  <path class="c-yarn-line" d="M-11 -6 q11 -6 22 4 M-13 2 q12 -5 25 6 M-6 -12 q3 12 -2 24 M4 -13 q-3 13 4 25"/></g>`;

const PAGE = (w, h, cls = '') => `<g class="${cls}"><path class="c-page" d="M0 0 h${w - 8} l8 8 v${h - 8} h-${w} z"/>
  <path class="c-page-fold" d="M${w - 8} 0 v8 h8"/>
  <path class="c-page-line" d="M5 ${h * 0.3} h${w - 12} M5 ${h * 0.45} h${w - 10} M5 ${h * 0.6} h${w - 16} M5 ${h * 0.75} h${w - 12}"/></g>`;

export const LOADER_SCENES = [
  {
    id: 'yarn',
    messages: ['Chasing the yarn of your document…', 'Pounce! …missed. Pounce again…', 'Untangling your pages…'],
    svg: `<svg class="scene scene-yarn" viewBox="0 0 260 160" aria-hidden="true">
      <path class="c-floor" d="M6 150 H254"/>
      <path class="c-yarn-thread" d="M0 148 C 40 140, 70 152, 110 146"/>
      <g class="yarn-roll"><g transform="translate(0 136)">${YARN}</g></g>
      <g class="chaser"><g class="hop"><g transform="translate(-6 40) scale(0.78)">${sittingBody('neutral')}</g></g></g>
    </svg>`,
  },
  {
    id: 'knead',
    messages: ['Kneading your pages…', 'Making biscuits out of your PDF…', 'Purr… purr… almost done…'],
    svg: `<svg class="scene scene-knead" viewBox="0 0 260 160" aria-hidden="true">
      <g transform="translate(68 2) scale(0.95)">${sittingBody('happy')}</g>
      <g class="purr"><path class="c-purr" d="M178 40 q6 -4 12 0 t12 0"/><path class="c-purr p2" d="M184 54 q5 -3 10 0 t10 0"/></g>
      <g class="stack">
        <rect class="c-page" x="74" y="132" width="112" height="16" rx="3"/>
        <rect class="c-page" x="70" y="124" width="118" height="16" rx="3"/>
        <g class="top-page"><rect class="c-page" x="66" y="114" width="126" height="18" rx="3"/>
        <path class="c-page-line" d="M78 121 h40 M126 121 h52 M78 126 h70"/></g>
      </g>
      <ellipse class="c-cream c-paw knead-l" cx="112" cy="114" rx="11" ry="7"/>
      <ellipse class="c-cream c-paw knead-r" cx="148" cy="114" rx="11" ry="7"/>
    </svg>`,
  },
  {
    id: 'push',
    messages: ['Knocking pages off the table (carefully)…', 'It was like that when I got here…', 'Gravity check… still works.'],
    svg: `<svg class="scene scene-push" viewBox="0 0 260 160" aria-hidden="true">
      <rect class="c-table" x="14" y="104" width="176" height="9" rx="4"/>
      <path class="c-table-leg" d="M30 113 v42 M174 113 v42"/>
      <g transform="translate(22 -4) scale(0.76)">${sittingBody('smug')}</g>
      <g class="push-paw"><path class="c-tail-o" d="M96 92 h20"/><path class="c-tail" d="M96 92 h20"/><ellipse class="c-cream c-paw" cx="120" cy="92" rx="7" ry="5.5"/></g>
      <g class="doc-fall"><g transform="translate(130 62)">${PAGE(32, 42)}</g></g>
    </svg>`,
  },
  {
    id: 'bat',
    messages: ['Batting at your pages…', 'Herding pages… it\'s like herding cats', 'Converting… paws-itively working'],
    svg: `<svg class="scene scene-bat" viewBox="0 0 260 160" aria-hidden="true">
      <path class="c-floor" d="M6 150 H254"/>
      <g transform="translate(46 8) scale(1)">${sittingBody('neutral')}</g>
      <g class="bat-arm"><path class="c-tail-o" d="M124 112 L150 86"/><path class="c-tail" d="M124 112 L150 86"/><ellipse class="c-cream c-paw" cx="152" cy="84" rx="7.5" ry="6"/></g>
      <g class="paper-bounce"><g transform="translate(166 40)">${PAGE(30, 38)}</g></g>
    </svg>`,
  },
  {
    id: 'hairball',
    messages: ['Coughing up a hairball of Markdown…', 'Grooming your text…', 'Licking the formatting clean…'],
    svg: `<svg class="scene scene-groom" viewBox="0 0 260 160" aria-hidden="true">
      <path class="c-floor" d="M6 150 H254"/>
      <g class="groom"><g transform="translate(66 8)">${sittingBody('sleepy')}</g></g>
      <g class="hash"><text class="c-hash" x="146" y="92" font-size="26" font-weight="800">#</text>
      <text class="c-hash h2" x="146" y="92" font-size="20" font-weight="800">*</text>
      <text class="c-hash h3" x="146" y="92" font-size="22" font-weight="800">-</text></g>
    </svg>`,
  },
];

/** Stretching / yawning cat for the startup splash. */
export function catStretching(cls = '') {
  return `<svg class="cat cat-stretch ${cls}" viewBox="0 0 125 142" aria-hidden="true" focusable="false">
    <g class="stretch">${sittingBody('yawn')}</g>
  </svg>`;
}

/** Happy cat with a wagging tail for success cards. */
export function catHappy(cls = '') {
  return `<svg class="cat cat-happy ${cls}" viewBox="0 0 125 142" aria-hidden="true" focusable="false">${sittingBody('happy')}</svg>`;
}

/* ------------------------------------------------------------ UI icons */

const ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
  merge: '<path d="M7 4v5a5 5 0 0 0 5 5h0a5 5 0 0 1 5 5v1M17 4v5a5 5 0 0 1-3 4.6M12 20v0"/><path d="M4 7l3-3 3 3M14 7l3-3 3 3"/>',
  edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/>',
  convert: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  markdown: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6.5 15V9l2.5 3 2.5-3v6M15.5 9v6M13.5 13l2 2 2-2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  rotl: '<path d="M4 4v5h5"/><path d="M4.6 9A8 8 0 1 1 6 16.5"/>',
  rotr: '<path d="M20 4v5h-5"/><path d="M19.4 9A8 8 0 1 0 18 16.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  textcursor: '<path d="M9 4h6M9 20h6M12 4v16"/><path d="M5 9l-2 3 2 3M19 9l2 3-2 3"/>',
  type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  sign: '<path d="M3 17c3-1 4-9 7-9s-1 9 2 9 3-4 5-4 2 3 4 3"/><path d="M3 21h18"/>',
  eraser: '<rect x="3.5" y="6.5" width="17" height="11" rx="1.5"/><path d="M3.5 14.5h17" stroke-dasharray="2 2"/>',
  zoomin: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M8 11h6M11 8v6"/>',
  zoomout: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M8 11h6"/>',
  save: '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  docx: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 12l1.5 5 1.5-4 1.5 4 1.5-5"/>',
  insert: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10M14 11v6M11 14h6"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16v-4h1.5a1.2 1.2 0 0 1 0 2.4H8.5"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}
