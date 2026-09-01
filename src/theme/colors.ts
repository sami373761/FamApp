/**
 * Colour tokens for FamApp, defined once per scheme.
 *
 * Every colour the UI uses should come from here so that adding a new scheme
 * (or rebranding) is a single-file change. Access these through `useTheme()`
 * rather than importing `Palette` directly in screens.
 *
 * Brand palette:
 *   primary green  #22C063  buttons, active states, important actions
 *   background     #FFFFFF  app canvas
 *   primary text   #1D1F1F  headings and body
 *   secondary text #161717  secondary copy and icons
 *   accent blue    #0366FF  links, highlights, secondary actions only
 *
 * The light canvas is pure white, so `surface` cannot separate a card from the
 * page by fill. Light-mode hierarchy is carried by `border`/`separator` plus the
 * faint `Shadow.card`, and greys move *down* from white: `surfaceMuted` is the
 * recessed fill (inputs, icon wells, chips, pressed rows), never a raised one.
 * Dark mode keeps the opposite convention — surfaces step up from the canvas.
 *
 * Each status hue carries three stops, not one: the solid (`primary`) for
 * foreground, the pastel (`primarySoft`) for a flat fill, and the paler
 * `*Wash`, which exists only as the far end of a gradient. A wash is always the
 * *closer* of the two to the canvas — white in light mode, `background` in dark
 * — so a `GradientSurface` fades into the page rather than away from it. That
 * is the whole reason the gradients read as tinted paper instead of decoration.
 */

/** Brand hues shared by both schemes. */
const brand = {
  green: '#22C063',
  greenPressed: '#1AA553',
  greenSoft: '#E7F8EE',
  greenSoftDark: '#123020',
  blue: '#0366FF',
  blueSoft: '#E8F1FF',
  blueSoftDark: '#10233D',
};

export const Palette = {
  light: {
    // Surfaces — all white; depth comes from lines and shadow, not fill
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceMuted: '#F1F2F2',

    // Text
    text: '#1D1F1F',
    textSecondary: '#161717',
    textTertiary: '#6E7272',
    textInverse: '#FFFFFF',

    // Lines — the primary way blocks read as separate on a white canvas
    border: '#E1E3E3',
    separator: '#ECEDED',

    // Brand
    primary: brand.green,
    primaryPressed: brand.greenPressed,
    primarySoft: brand.greenSoft,
    onPrimary: '#FFFFFF',

    // Accent — links, highlights, secondary actions
    accent: brand.blue,
    accentSoft: brand.blueSoft,

    // Status
    success: brand.green,
    successSoft: brand.greenSoft,
    warning: '#C77C1A',
    warningSoft: '#FBF1E3',
    danger: '#E5484D',
    dangerSoft: '#FCEBEC',
    info: brand.blue,
    infoSoft: brand.blueSoft,

    // Gradient far ends — each a breath away from the white canvas
    primaryWash: '#F6FCF8',
    warningWash: '#FDF9F2',
    dangerWash: '#FEF7F7',
    infoWash: '#F5F9FF',

    // Misc
    overlay: 'rgba(29, 31, 31, 0.45)',
    mapCanvas: '#EBEDEC',
  },

  dark: {
    // Surfaces
    background: '#101211',
    surface: '#181A19',
    surfaceElevated: '#1E2120',
    surfaceMuted: '#232625',

    // Text
    text: '#F5F6F6',
    textSecondary: '#E3E5E4',
    textTertiary: '#8C918F',
    textInverse: '#1D1F1F',

    // Lines
    border: '#2B2F2D',
    separator: '#242827',

    // Brand
    primary: '#2FCF72',
    primaryPressed: '#25B463',
    primarySoft: brand.greenSoftDark,
    onPrimary: '#0A1F12',

    // Accent — links, highlights, secondary actions
    accent: '#4C93FF',
    accentSoft: brand.blueSoftDark,

    // Status
    success: '#2FCF72',
    successSoft: brand.greenSoftDark,
    warning: '#E8A94B',
    warningSoft: '#2E2515',
    danger: '#F2696D',
    dangerSoft: '#301A1B',
    info: '#4C93FF',
    infoSoft: brand.blueSoftDark,

    // Gradient far ends — here they settle toward the near-black canvas
    primaryWash: '#131C17',
    warningWash: '#1C1A15',
    dangerWash: '#1D1617',
    infoWash: '#131A22',

    // Misc
    overlay: 'rgba(0, 0, 0, 0.6)',
    mapCanvas: '#141716',
  },
} as const;

/** Union of every token name; both schemes are kept structurally identical. */
export type ColorToken = keyof typeof Palette.light & keyof typeof Palette.dark;

export type ThemeColors = Record<ColorToken, string>;

/**
 * Fixed accent colours used to distinguish family members (map pins, avatar
 * fallbacks). Deliberately scheme-independent so a person keeps one identity
 * colour in light and dark mode. Drawn from the brand palette first, then
 * extended with hues that stay legible against it.
 */
export const MemberColors = [
  '#22C063',
  '#0366FF',
  '#E5484D',
  '#C77C1A',
  '#8B5CF6',
  '#0E9AA7',
] as const;
