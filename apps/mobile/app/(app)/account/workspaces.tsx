import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { useWorkspaces } from "@/lib/api/account";
import { describeError, useOnline } from "@/lib/api/errors";
import { tokenStore } from "@/lib/api/token-store";
import { haptics } from "@/lib/haptics";
import { ErrorState } from "@/components/error-state";
import { Row, Section } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Workspace switcher.
 *
 * Switching drops every cached query rather than invalidating it. Invalidation
 * leaves the previous workspace's meetings, action items, and search results on
 * screen until each refetch lands — which is a data-partitioning bug the user
 * can see, and briefly shows one client's meetings under another client's name.
 * Resetting returns those screens to their loading state instead.
 *
 * That is only true while there is a network to refill them from. A reset with
 * no connection leaves every screen in the app on a loading state that can
 * never finish, so the switch is refused offline and says why. Refusing is
 * honest in a way that switching-and-hanging is not: nothing about the new
 * workspace can be shown until something is fetched.
 */
/**
 * Human words for the stored enum.
 *
 * `workspaces.kind` is CHECK-constrained to 'student' | 'professional' and was
 * rendered straight to screen, so the row read "Personal" over a lowercase
 * "professional" — raw column data in the UI. The fallback returns the value
 * unchanged rather than a placeholder: if a third kind is ever added, showing
 * the unfamiliar word is more useful than showing nothing while somebody
 * notices this function exists.
 */
function describeKind(kind: string | undefined): string {
  const known: Record<string, string> = {
    student: "Study workspace",
    professional: "Work workspace",
  };
  if (!kind) return "";
  return known[kind] ?? kind;
}

export default function WorkspacesScreen() {
  const online = useOnline();
  const query = useWorkspaces();
  const queryClient = useQueryClient();

  // The token store is not reactive, so the selection is mirrored here.
  const [activeId, setActiveId] = useState<string | null>(() => tokenStore.getWorkspaceId());

  const onRefresh = useCallback(() => query.refetch(), [query]);

  const workspaces = query.data;

  /**
   * A failed fetch used to be pixel-identical to a real empty account: both
   * rendered the "No workspaces came back" footnote. They mean opposite things
   * and only one of them is worth retrying.
   */
  if (!workspaces) {
    if (query.isError || query.isPaused) {
      const copy = describeError(query.error, { online, subject: "your workspaces" });
      return (
        <SettingsScroll onRefresh={onRefresh}>
          <ErrorState
            title={copy.title}
            body={copy.body}
            detail={query.error?.message}
            onRetry={copy.retryable ? () => void query.refetch() : undefined}
            busy={query.isFetching}
          />
        </SettingsScroll>
      );
    }

    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel="Loading your workspaces" />
      </View>
    );
  }

  // Nothing stored yet means the API is defaulting to the first workspace.
  const selectedId = activeId ?? workspaces[0]?.id ?? null;

  const select = (id: string) => {
    if (id === selectedId) return;

    if (!online) {
      haptics.warning();
      Alert.alert(
        "Switching needs a connection",
        "EchoBrief has to load the other workspace's meetings and action items before it can show them, and it cannot do that offline.",
      );
      return;
    }

    haptics.select();
    tokenStore.setWorkspaceId(id);
    setActiveId(id);

    // Reset, not invalidate: see the note above. Every screen this empties now
    // renders its own error state if the refetch fails, so a reset that cannot
    // refill is visible and retryable rather than a permanent spinner.
    void queryClient.resetQueries();
  };

  return (
    <SettingsScroll onRefresh={onRefresh}>
      {workspaces.length > 0 ? (
        <Section
          title="Your workspaces"
          footer="Meetings, action items, and search are scoped to the selected workspace."
        >
          {workspaces.map((workspace) => (
            <Row
              key={workspace.id}
              label={workspace.name}
              detail={describeKind(workspace.kind)}
              selected={workspace.id === selectedId}
              onPress={() => select(workspace.id)}
              hint="Switches to this workspace"
            />
          ))}
        </Section>
      ) : (
        <Footnote>
          No workspaces came back for this account. Everything you record is going to your personal
          space.
        </Footnote>
      )}

      <Footnote>
        Creating, renaming, and inviting people to a workspace happens on the web.
      </Footnote>
    </SettingsScroll>
  );
}
