/**
 * A poll rendered inline in the message stream.
 *
 * The chat row it replaces is a real `messages` row of type `text`, and its
 * content is the question itself. That is the one difference from
 * `TaskMessageCard`, which replaces FamApp's own announcement: a task's card
 * stands in for a line nobody wrote, a poll's card stands in for a line its
 * author did write, so the question is repeated at the top of the card rather
 * than being lost. Lose the poll — delete the message, or let the 30-day sweep
 * take it — and what is left is somebody having asked their family a question,
 * which is exactly what happened.
 *
 * Full-width rather than bubble-shaped, for the same reason the task card is:
 * it is a surface with controls on it, not a remark. The author's avatar still
 * sits beside it, because a real member did ask.
 *
 * **The tally is folded, never stored.** `tallyPoll` recomputes from the vote
 * rows on every render, so a vote arriving over the socket moves the bars in
 * the same commit it lands in and the card cannot disagree with itself. There
 * is no count column and there must not be one.
 *
 * **Pressing your own answer takes it back.** That toggle is decided here, at
 * the control, and handed to `votePoll` as a null — the same split
 * `TaskStatusActions` makes for a task's status, so what a second press means
 * is settled in one place rather than in each writer.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { clockTime, memberName } from '@/data/format';
import { tallyPoll, votersFor, type PollOptionTally } from '@/data/polls';
import type { ChatPoll, FamilyMember, PollVote } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Motion, Radius, Spacing } from '@/theme';

/** How many faces an answer shows before it starts counting the rest. */
const MAX_FACES = 3;

type PollMessageCardProps = {
  poll: ChatPoll;
  /** The family's whole vote list; `tallyPoll` filters to this poll. */
  votes: PollVote[];
  /** When the question was posted — the card's own timestamp. */
  createdAt: string;
  /** Who asked; undefined for a member who has since left. */
  author?: FamilyMember;
  /** True when the signed-in user asked it. */
  isOwn: boolean;
  /** Decides which answer is marked as theirs, and what a second press means. */
  currentUserId?: string | null;
  /** Resolves member ids to faces, exactly as the task card resolves an assignee. */
  getMember: (id: string | null | undefined) => FamilyMember | undefined;
  /**
   * Null means "take my vote back" — the card has already applied the toggle
   * rule, so the writer does not have to know about it.
   */
  onVote: (optionIndex: number | null) => void;
  busy?: boolean;
};

export function PollMessageCard({
  poll,
  votes,
  createdAt,
  author,
  isOwn,
  currentUserId,
  getMember,
  onVote,
  busy = false,
}: PollMessageCardProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;

  const tally = tallyPoll(poll, votes, currentUserId);

  return (
    <View style={styles.row}>
      <View style={styles.avatarSlot}>
        {author ? (
          <Avatar
            initials={author.initials}
            colorIndex={author.colorIndex}
            avatar={author.avatar}
            size="sm"
          />
        ) : null}
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            // The accent edge is what separates a poll from a message at a
            // glance on a canvas where cards cannot separate themselves by
            // fill. `accent` rather than `primary`: green is what the family
            // *does* — a task, a completion — and a question is not an action.
            borderColor: colors.accent,
          },
        ]}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="stats-chart" size={14} color={colors.accent} />
          </View>

          <Text variant="label" color="textSecondary" style={styles.flex}>
            {(isOwn
              ? t('poll.youAsked')
              : t('poll.someoneAsked', {
                  name: author ? memberName(i18n, author) : t('common.someone'),
                })
            ).toUpperCase()}
          </Text>

          <Text variant="label" color="textTertiary">
            {clockTime(i18n, createdAt)}
          </Text>
        </View>

        {/* Repeated rather than dropped: this card is drawn *in place of* the
            message that says it, so without this the question would be the one
            thing missing from the poll. */}
        <Text variant="bodyStrong">{poll.question}</Text>

        <View style={styles.options}>
          {tally.options.map((option) => (
            <PollOption
              key={option.index}
              option={option}
              // Whoever answered this way. Ids, resolved by the caller's own
              // `getMember` — the rule every component here follows.
              voters={votersFor(poll.id, option.index, votes)
                .map((memberId) => getMember(memberId))
                .filter((member): member is FamilyMember => !!member)}
              // Nobody has voted, so no bar is drawn at all and the answers read
              // as the buttons they are rather than as an empty chart.
              hasVotes={tally.total > 0}
              disabled={busy}
              onPress={() =>
                // The toggle: pressing the answer you are already on retracts.
                onVote(tally.myOptionIndex === option.index ? null : option.index)
              }
            />
          ))}
        </View>

        <View style={styles.footer}>
          {busy ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}

          <Text variant="label" color="textTertiary" style={styles.flex}>
            {tally.total === 0 ? t('poll.noVotes') : t('poll.voteCount', { count: tally.total })}
          </Text>

          {/* Only once they have answered — telling somebody who has not voted
              that they may change their vote is answering a question they have
              not asked. */}
          {tally.myOptionIndex !== null ? (
            <Text variant="label" color="textTertiary">
              {t('poll.changeHint')}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

type PollOptionProps = {
  option: PollOptionTally;
  voters: FamilyMember[];
  hasVotes: boolean;
  disabled: boolean;
  onPress: () => void;
};

/**
 * One answer: a pressable row with its own share drawn behind the label.
 *
 * The bar is a sibling *behind* the content rather than a fill under it — the
 * same construction `PressableScale`'s highlight uses, and for the same reason:
 * a layer drawn over the row would wash out the text it is meant to be under.
 * It is absolutely positioned, so it takes no layout and a row of 4% and a row
 * of 96% are exactly the same height.
 *
 * The width animates rather than snapping, because a vote arriving from another
 * member is the one thing on this card that changes without the reader touching
 * anything — a bar that jumped would be a number that had silently already
 * moved. It is `Animated`, timed from `Motion`, like every other animation in
 * this app; `react-native-reanimated` is still a dependency nothing imports.
 */
function PollOption({ option, voters, hasVotes, disabled, onPress }: PollOptionProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  /*
    `width` is a layout property, which the native driver cannot carry on any
    platform — so this is the one animation in the app that is off the native
    driver by nature rather than because of the web target. Interpolating a
    percentage string is what keeps the bar correct at every row width without
    measuring anything.
  */
  const share = useRef(new Animated.Value(option.percent)).current;

  useEffect(() => {
    Animated.timing(share, {
      toValue: option.percent,
      duration: Motion.duration.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [option.percent, share]);

  const hidden = voters.length - MAX_FACES;

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected: option.isMine, disabled }}
      accessibilityLabel={option.label}
      accessibilityHint={
        hasVotes ? t('poll.optionA11y', { count: option.votes, percent: option.percent }) : undefined
      }
      disabled={disabled}
      onPress={onPress}
      // Moving within a set, not committing — the same effect `Segmented` and
      // the assignee chips use, and the one the thumb expects from an answer
      // that can be changed. `TaskStatusActions` uses `success` for finishing
      // because that ends something; a vote never does.
      feedback="select"
      // A full-width row, so it dips barely at all — the bar and the tick carry
      // the state change.
      scaleTo={0.99}
      style={[
        styles.option,
        {
          borderColor: option.isMine ? colors.accent : colors.border,
          backgroundColor: colors.surface,
        },
        disabled && styles.dimmed,
      ]}>
      {/* Behind the content and taking no layout. Withheld entirely until
          somebody votes, so an unanswered poll is four buttons rather than four
          empty bars. */}
      {hasVotes ? (
        <Animated.View
          style={[
            styles.bar,
            {
              backgroundColor: option.isMine ? colors.accentSoft : colors.surfaceMuted,
              width: share.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      ) : null}

      <Text
        variant={option.isMine ? 'bodyStrong' : 'body'}
        color={option.isMine ? 'accent' : 'text'}
        numberOfLines={2}
        style={styles.flex}>
        {option.label}
      </Text>

      {/* Who answered this way. A family poll is not an anonymous one — five
          people in a household already know who said what, and hiding it would
          be ceremony rather than privacy. */}
      {voters.length > 0 ? (
        <View style={styles.faces}>
          {voters.slice(0, MAX_FACES).map((member, index) => (
            <View key={member.id} style={index > 0 ? styles.faceOverlap : undefined}>
              <Avatar
                initials={member.initials}
                colorIndex={member.colorIndex}
                avatar={member.avatar}
                size="sm"
              />
            </View>
          ))}
          {hidden > 0 ? (
            <Text variant="label" color="textTertiary" style={styles.overflow}>
              {t('poll.moreVoters', { count: hidden })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {hasVotes ? (
        <Text
          variant="captionStrong"
          color={option.isLeading ? 'accent' : 'textTertiary'}
          style={styles.percent}>
          {t('poll.percent', { percent: option.percent })}
        </Text>
      ) : null}

      {option.isMine ? (
        <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, marginBottom: Spacing.sm },
  // Matches `MessageBubble` and `TaskMessageCard`, so bubbles and cards line up
  // down the same column.
  avatarSlot: { width: 32 },
  card: {
    flex: 1,
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: { gap: Spacing.xs, marginTop: Spacing.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    // Clips the bar to the row's own corner.
    overflow: 'hidden',
  },
  // Absolutely positioned so a bar at 4% and one at 96% leave the row the same
  // height, and drawn behind the label rather than over it.
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  dimmed: { opacity: 0.6 },
  faces: { flexDirection: 'row', alignItems: 'center' },
  faceOverlap: { marginLeft: -10 },
  overflow: { marginLeft: Spacing.xs },
  // Bounded so a three-digit percentage cannot squeeze the label beside it.
  percent: { minWidth: 36, textAlign: 'right' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
});
