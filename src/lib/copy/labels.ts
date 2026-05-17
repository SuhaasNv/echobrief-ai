/**
 * Vocabulary dictionary keyed by workspace kind.
 *
 * Components don't hardcode "Meetings" / "Action Items" — they read from
 * `useLabels()` so the active workspace's kind drives the UX vocabulary.
 * Switching workspaces from student → professional flips every label.
 */

export type WorkspaceKind = "student" | "professional";

export interface LabelSet {
  meeting: {
    singular: string;
    plural: string;
    upload_cta: string;
    score: string;
  };
  actions: {
    singular: string;
    plural: string;
  };
  chat: {
    title: string;
  };
  notes: {
    library: string;
  };
  workspace: {
    singular: string;
    plural: string;
    create_cta: string;
  };
  search: {
    scope: string;
  };
  cta: {
    signup_blurb: string;
  };
  nav: {
    dashboard: string;
    upload: string;
    meetings: string;
    chat: string;
    actions: string;
    notes: string;
    analytics: string;
    study: string;
  };
}

const PROFESSIONAL: LabelSet = {
  meeting: {
    singular: "Meeting",
    plural: "Meetings",
    upload_cta: "Upload meeting",
    score: "Meeting score",
  },
  actions: {
    singular: "Action item",
    plural: "Action Items",
  },
  chat: {
    title: "Ask EchoBrief",
  },
  notes: {
    library: "Notes library",
  },
  workspace: {
    singular: "Workspace",
    plural: "Workspaces",
    create_cta: "Create workspace",
  },
  search: {
    scope: "Cross-meeting search",
  },
  cta: {
    signup_blurb: "Your meetings finally become searchable intelligence.",
  },
  nav: {
    dashboard: "Dashboard",
    upload: "Upload",
    meetings: "Meetings",
    chat: "AI Chat",
    actions: "Action Items",
    notes: "Notes library",
    analytics: "Analytics",
    study: "Study",
  },
};

const STUDENT: LabelSet = {
  meeting: {
    singular: "Lecture",
    plural: "Lectures",
    upload_cta: "Record lecture",
    score: "Lecture quality",
  },
  actions: {
    singular: "Task",
    plural: "Tasks",
  },
  chat: {
    title: "Ask EchoBrief",
  },
  notes: {
    library: "Class notes",
  },
  workspace: {
    singular: "Class",
    plural: "Classes",
    create_cta: "Create class",
  },
  search: {
    scope: "Cross-lecture search",
  },
  cta: {
    signup_blurb: "Your lectures finally become searchable knowledge.",
  },
  nav: {
    dashboard: "Dashboard",
    upload: "Record",
    meetings: "Lectures",
    chat: "Ask EchoBrief",
    actions: "Tasks",
    notes: "Class notes",
    analytics: "Analytics",
    study: "Study",
  },
};

export function getLabels(kind: WorkspaceKind): LabelSet {
  return kind === "student" ? STUDENT : PROFESSIONAL;
}
