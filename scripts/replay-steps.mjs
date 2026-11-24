// The made-up changes the replay steps through: who made each one, why, and its changes in order.

// A short sequence for the Community Garden Planner: a part starts, both parts of the weekly
// tasks card are solved (so the card shows solved), its owner confirms it, a re-rank, and the
// re-ranked card's next part starts.
export const GARDEN_STEPS = [
  {
    say: "Reminders (gp-022) moves from next to now",
    actor: "Tech Coach",
    why: "The task list is nearly done, so watering reminders start alongside it",
    changes: [{ card: "gp-022", status: "now" }],
  },
  {
    say: "The task list (gp-021) is solved",
    actor: "Product Coach",
    why: "Checked against the problem statement: each bed lists its tasks for the week",
    changes: [{ card: "gp-021", status: "done" }],
  },
  {
    say: "Reminders (gp-022) is solved, so its parent card shows solved",
    actor: "Product Coach",
    why: "Checked against the problem statement: a gardener was reminded of an overdue bed",
    changes: [{ card: "gp-022", status: "done" }],
  },
  {
    say: "The weekly tasks card (gp-002) is confirmed solved",
    actor: "Product Coach",
    why: "Both parts done; gardeners planned a week of tasks unaided",
    changes: [{ card: "gp-002", status: "done" }],
  },
  {
    say: "Re-rank: the welcome card (gp-007) moves ahead of harvest logging (gp-006)",
    actor: "Product Coach",
    why: "Sign-ups for the new season open next week; harvest logging can wait for the autumn",
    changes: [{ card: "gp-007", order: 3 }, { card: "gp-006", order: 7 }],
  },
  {
    say: "The welcome card (gp-007) and its note (gp-072) move from next to now",
    actor: "Tech Coach",
    why: "Next in line after the re-rank",
    changes: [{ card: "gp-007", status: "now" }, { card: "gp-072", status: "now" }],
  },
];
