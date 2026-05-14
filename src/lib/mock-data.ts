export type Meeting = {
  id: string;
  title: string;
  date: string;
  duration: string;
  participants: { name: string; initials: string; color: string }[];
  status: "ready" | "processing" | "failed";
  summary: string;
  tags: string[];
  actionCount: number;
};

export const meetings: Meeting[] = [
  {
    id: "q3-planning",
    title: "Q3 Planning Sync",
    date: "Today · 9:42 AM",
    duration: "47 min",
    participants: [
      { name: "Maya Chen", initials: "MC", color: "from-brand to-violet" },
      { name: "David Park", initials: "DP", color: "from-success to-brand" },
      { name: "Priya Rao", initials: "PR", color: "from-violet to-warning" },
      { name: "Liam Ortiz", initials: "LO", color: "from-warning to-destructive" },
    ],
    status: "ready",
    summary: "Aligned on a September 18 launch contingent on pricing page redesign and partner outreach.",
    tags: ["planning", "launch"],
    actionCount: 5,
  },
  {
    id: "acme-discovery",
    title: "Acme Corp · Discovery Call",
    date: "Today · 11:15 AM",
    duration: "32 min",
    participants: [
      { name: "Maya Chen", initials: "MC", color: "from-brand to-violet" },
      { name: "Jordan Kim", initials: "JK", color: "from-violet to-brand" },
    ],
    status: "ready",
    summary: "Acme wants SSO + workspace analytics. Decision-maker is VP Eng. Follow up Friday.",
    tags: ["sales", "enterprise"],
    actionCount: 3,
  },
  {
    id: "design-review",
    title: "Design Review · Onboarding v3",
    date: "Yesterday · 3:00 PM",
    duration: "1h 12 min",
    participants: [
      { name: "Sara Lin", initials: "SL", color: "from-success to-brand" },
      { name: "David Park", initials: "DP", color: "from-success to-brand" },
      { name: "Anika Roy", initials: "AR", color: "from-violet to-warning" },
    ],
    status: "processing",
    summary: "Review of new onboarding flow. Empty state and waveform animation feedback collected.",
    tags: ["design", "onboarding"],
    actionCount: 7,
  },
  {
    id: "leadership",
    title: "Leadership Standup",
    date: "Yesterday · 9:00 AM",
    duration: "28 min",
    participants: [
      { name: "Maya Chen", initials: "MC", color: "from-brand to-violet" },
      { name: "Eli Brooks", initials: "EB", color: "from-warning to-destructive" },
      { name: "Anika Roy", initials: "AR", color: "from-violet to-warning" },
    ],
    status: "ready",
    summary: "Hiring plan finalized for Q3. Ops bottleneck on procurement flagged.",
    tags: ["leadership"],
    actionCount: 2,
  },
  {
    id: "research",
    title: "User Research · Power Users",
    date: "Mon · 2:30 PM",
    duration: "54 min",
    participants: [
      { name: "Priya Rao", initials: "PR", color: "from-violet to-warning" },
      { name: "Sara Lin", initials: "SL", color: "from-success to-brand" },
    ],
    status: "ready",
    summary: "Six power users want cross-meeting search. Concern around export formats.",
    tags: ["research"],
    actionCount: 4,
  },
];

export const transcriptLines = [
  { t: "00:00", who: "Maya Chen", color: "brand", text: "Thanks for jumping on. I want us to leave today with one decision: when does Q3 ship?" },
  { t: "00:14", who: "David Park", color: "success", text: "From engineering we're 80% there on the new pricing page. Two weeks of polish, plus QA." },
  { t: "00:42", who: "Maya Chen", color: "brand", text: "Let's lock in the Q3 launch date — I'm proposing September 18.", highlight: true },
  { t: "00:58", who: "David Park", color: "success", text: "That works on engineering. Pricing page redesign ships before then.", highlight: true },
  { t: "01:14", who: "Priya Rao", color: "violet", text: "I'll own the partner outreach by next Friday." },
  { t: "01:32", who: "Liam Ortiz", color: "warning", text: "Marketing needs the date confirmed by Monday to lock in the press cycle." },
  { t: "01:48", who: "Maya Chen", color: "brand", text: "Done. I'll send a calendar hold by EOD. David, can you own the engineering rollout doc?" },
  { t: "02:05", who: "David Park", color: "success", text: "On it. I'll have a draft tomorrow." },
  { t: "02:18", who: "Priya Rao", color: "violet", text: "What about the legacy Starter tier? Are we sunsetting at launch or after?" },
  { t: "02:30", who: "Maya Chen", color: "brand", text: "After. Let's not change two things at once. Decision: keep Starter through end of year." },
];

export const actionItems = [
  { id: 1, title: "Confirm September 18 launch date with marketing", owner: "Maya", due: "Today", meeting: "Q3 Planning Sync", done: false },
  { id: 2, title: "Draft engineering rollout doc", owner: "David", due: "Tomorrow", meeting: "Q3 Planning Sync", done: false },
  { id: 3, title: "Partner outreach to top 5 integrations", owner: "Priya", due: "Fri", meeting: "Q3 Planning Sync", done: false },
  { id: 4, title: "Pricing page v2 ready for QA", owner: "David", due: "Aug 30", meeting: "Q3 Planning Sync", done: false },
  { id: 5, title: "Send Acme proposal w/ SSO add-on", owner: "Maya", due: "Fri", meeting: "Acme Discovery", done: false },
  { id: 6, title: "Schedule follow-up w/ Acme VP Eng", owner: "Jordan", due: "Mon", meeting: "Acme Discovery", done: true },
  { id: 7, title: "Redesign empty state in onboarding", owner: "Sara", due: "Aug 28", meeting: "Design Review", done: false },
];
