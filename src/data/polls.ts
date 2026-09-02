/**
 * Counting a poll's answers.
 *
 * A fold over two row sets the screen already holds, exactly like
 * `membersAtPlaces` folding positions against places — and for the same reason
 * there is no stored tally. A count written down is wrong the moment somebody
 * votes, and the socket delivers votes one at a time; recomputing from the rows
 * is what makes a card that cannot disagree with itself.
 *
 * Pure, like the rest of `data/`: no `Translator`, because nothing here
 * produces copy — the card renders the numbers and the catalog supplies the
 * words around them.
 */

import type { ChatPoll, PollVote } from '@/data/types';

/** One answer, with everything the card draws for it. */
export type PollOptionTally = {
  index: number;
  label: string;
  votes: number;
  /**
   * 0–100, rounded, and it is **presentation only** — three answers splitting a
   * poll evenly give 33/33/33, which does not add to 100. The bars are what
   * this is for, and forcing the last one to absorb the remainder would make it
   * disagree with its own count.
   */
  percent: number;
  /** Whether the reader's own vote is on this option. */
  isMine: boolean;
  /** True for the option (or options — a tie) with the most votes, once anyone has voted. */
  isLeading: boolean;
};

export type PollTally = {
  options: PollOptionTally[];
  /** How many members have answered. Also the denominator behind `percent`. */
  total: number;
  /** The reader's own answer, or null when they have not voted. */
  myOptionIndex: number | null;
};

/**
 * Folds a poll's options against the votes cast on it.
 *
 * `votes` is the family's whole vote list rather than this poll's, because that
 * is what `FamilyContext` holds and filtering here keeps the caller from having
 * to build an index per card. A family's polls are bounded by chat retention,
 * so this stays a scan over a small list.
 *
 * A vote pointing outside the options array is ignored rather than counted into
 * a bucket that does not exist. `private.check_poll_vote()` makes that
 * impossible to write today, but the array is what the tally is drawn from and
 * an out-of-range index would otherwise be a silent `undefined` in the middle
 * of the card.
 */
export function tallyPoll(
  poll: ChatPoll,
  votes: PollVote[],
  currentUserId?: string | null,
): PollTally {
  const counts = poll.options.map(() => 0);
  let total = 0;
  let myOptionIndex: number | null = null;

  for (const vote of votes) {
    if (vote.pollId !== poll.id) continue;
    if (vote.optionIndex < 0 || vote.optionIndex >= counts.length) continue;

    counts[vote.optionIndex] += 1;
    total += 1;

    if (currentUserId && vote.memberId === currentUserId) myOptionIndex = vote.optionIndex;
  }

  // Nobody has voted, so nothing leads. Without this every option would tie at
  // zero and the card would highlight all of them.
  const best = total === 0 ? -1 : Math.max(...counts);

  return {
    options: poll.options.map((label, index) => ({
      index,
      label,
      votes: counts[index],
      percent: total === 0 ? 0 : Math.round((counts[index] / total) * 100),
      isMine: myOptionIndex === index,
      isLeading: counts[index] === best,
    })),
    total,
    myOptionIndex,
  };
}

/**
 * Who voted for one option.
 *
 * Ids, not members — the screen resolves them through `getMember`, which is the
 * rule every other component here follows. Used for the row of faces under an
 * answer, which is what makes a family poll different from an anonymous one:
 * five people in a household already know who said what, and hiding it would be
 * ceremony rather than privacy.
 */
export function votersFor(pollId: string, optionIndex: number, votes: PollVote[]): string[] {
  return votes
    .filter((vote) => vote.pollId === pollId && vote.optionIndex === optionIndex)
    .map((vote) => vote.memberId);
}
