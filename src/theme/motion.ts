/**
 * Motion tokens.
 *
 * The same argument as `Spacing` and `Radius`: a duration typed at a call site
 * is a number nobody can keep in step with the twenty other places that meant
 * the same thing. There are four of them because the app only ever animates
 * four kinds of change — a control answering a finger, a value settling, a
 * panel arriving, and that panel leaving again.
 *
 * Everything here drives RN's own `Animated`. This project has no animation
 * library and does not want one: `react-native-reanimated` sits unused in
 * `package.json` and waking it for a transform would be the heavier choice.
 */

export const Motion = {
  duration: {
    /** A pressed surface answering the finger — below this it reads as a jump. */
    press: 90,
    /** A value swapping in place: a chevron turning, content cross-fading. */
    fast: 150,
    /** The default for anything that moves a whole element. */
    base: 200,
    /** A panel travelling the height of itself. */
    panel: 280,
    /** The same panel leaving, deliberately quicker — waiting to dismiss is the
     *  one part of a transition a user always experiences as lag. */
    exit: 180,
  },

  spring: {
    /** The press dip. No bounciness: a button that wobbles back reads as a toy. */
    press: { speed: 45, bounciness: 0 },
    /** A surface settling into place — just enough overshoot to read as physical. */
    settle: { speed: 20, bounciness: 6 },
  },

  /**
   * How far content shifts while it fades in. Small on purpose: the fade is
   * what the eye reads, and the travel only gives it a direction.
   */
  shift: 8,

  /** How far a sheet must be dragged before release dismisses it. */
  dismissDistance: 96,
  /** …or how fast, for a flick that never travels that far. */
  dismissVelocity: 0.75,
} as const;
