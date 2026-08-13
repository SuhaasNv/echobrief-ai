import { useEffect } from "react";
import { Alert } from "react-native";
import { onlineManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { describeActionFailure } from "@/lib/api/errors";
import type { SummaryLength, SummaryStyle, SummaryTone } from "@/components/settings/preferences";
import {
  RETENTION_WINDOWS,
  setPreference,
  usePreferences,
} from "@/components/settings/preferences";

/**
 * The preferences the pipeline actually reads.
 *
 * Everything else on the settings screens is device-local and says so. These
 * are different: the worker consumes them, so a value that never leaves the
 * phone is a promise the product breaks on the next recording. Vocabulary feeds
 * AssemblyAI's word_boost, language chooses between a fixed language and
 * detection, profanity filtering is AssemblyAI's filter_profanity, retention
 * decides when the audio is deleted, and the four summary fields shape the
 * analysis prompt.
 *
 * The device store stays the source of truth for RENDERING — every screen reads
 * it synchronously and none of them should show a spinner to draw a switch —
 * and this module keeps the server in step with it: seed on mount, write
 * through on change. That is the migration the store's own header describes.
 */

/** Mirrors UserPreferences in packages/shared. Kept narrow: only what is read. */
export interface ServerPreferences {
  transcription_language: string | null;
  vocabulary: string[];
  audio_retention_days: number | null;
  /**
   * How summaries are written. Null on the three enums means "never chosen",
   * which the pipeline treats as "write it the way you would have before these
   * existed" — deliberately not the same as choosing the default.
   */
  summary_style: SummaryStyle | null;
  summary_length: SummaryLength | null;
  summary_tone: SummaryTone | null;
  detect_action_items: boolean;
  /**
   * Whether the transcriber is asked to mask profanity. Not nullable: filtering
   * has always been off, so "never chosen" and "off" are the same behaviour and
   * a third state would only resolve to false anyway.
   */
  filter_profanity: boolean;
  /**
   * What `null` resolves to server-side. Returned so the unset state can be
   * labelled with the real number rather than a constant duplicated here, which
   * is exactly how the copy came to claim 90 days while the worker deleted at 7.
   */
  default_audio_retention_days: number;
}

export interface PreferencesPatch {
  transcription_language?: string | null;
  vocabulary?: string[];
  audio_retention_days?: number | null;
  summary_style?: SummaryStyle | null;
  summary_length?: SummaryLength | null;
  summary_tone?: SummaryTone | null;
  detect_action_items?: boolean;
  filter_profanity?: boolean;
}

export const preferenceKeys = {
  all: ["account", "preferences"] as const,
};

export function useServerPreferences() {
  return useQuery({
    queryKey: preferenceKeys.all,
    queryFn: () => api.apiRequest<ServerPreferences>("/account/preferences"),
    // These change only when the user edits them, and the device copy renders
    // in the meantime, so refetching on every focus buys nothing.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Seed the device store from the server, once, on first successful read.
 *
 * Server wins on seed, and only for the fields the pipeline reads. A fresh
 * install has defaults that were never chosen, and treating those as an edit
 * would push them up and quietly overwrite the real preferences set on another
 * device. After the seed the device store leads and every change writes through.
 */
export function usePreferenceSync(): void {
  const { data } = useServerPreferences();

  useEffect(() => {
    if (!data) return;

    setPreference(
      "language",
      data.transcription_language === "auto" ? null : data.transcription_language,
    );
    setPreference("vocabulary", data.vocabulary);
    // Seeded unconditionally, like detect_action_items below: it is a plain
    // boolean with no "never chosen" state, so `false` from the server is a real
    // value and skipping it on falsiness would leave a device that had it on
    // showing on after another device turned it off.
    setPreference("filterProfanity", data.filter_profanity);

    /**
     * Seed the AI-output choices too.
     *
     * These four were device-local and inert until migration 0018 gave them
     * columns and the worker started reading them — a user could pick "Bullet
     * points" and get identical prose. Now they are server state like the rest,
     * so the device copy is seeded from the server on first read and written
     * through on every change.
     *
     * Null is preserved rather than defaulted: it means the user has never
     * chosen, and turning that into a concrete value here would push a choice
     * they never made up to the server on the next unrelated save.
     */
    if (data.summary_style) setPreference("summaryStyle", data.summary_style);
    if (data.summary_length) setPreference("summaryLength", data.summary_length);
    if (data.summary_tone) setPreference("tone", data.summary_tone);
    setPreference("detectActionItems", data.detect_action_items);
    // `0` is a real choice — keep until deleted by hand — and must survive the
    // round trip, so only `null` falls back to the server's default. Narrowed
    // rather than cast: the column allows 0-365 while the picker offers a fixed
    // set, and a value outside it would render as no selection at all.
    const days = data.audio_retention_days ?? data.default_audio_retention_days;
    const known = RETENTION_WINDOWS.find((choice) => choice.value === days);
    if (known) setPreference("retentionDays", known.value);
  }, [data]);
}

/**
 * Push a change to the server, and tell the user if it does not land.
 *
 * networkMode "always" so this FAILS offline rather than parking in a queue the
 * user cannot see: a vocabulary term that silently never syncs is worse than
 * one that says it did not, because the next recording quietly mangles the word
 * it was added to fix.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always",
    mutationFn: (patch: PreferencesPatch) =>
      api.apiRequest<ServerPreferences>("/account/preferences", {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: (fresh) => {
      // The server returns the merged row, so this is the authoritative state
      // without a second round trip.
      queryClient.setQueryData(preferenceKeys.all, fresh);
    },
    onError: (error) => {
      Alert.alert(
        "That setting did not save",
        `${describeActionFailure(error, { online: onlineManager.isOnline() })} It is still set on this iPhone, but recordings will use the previous value until it syncs.`,
      );
    },
  });
}

/** Read the device copy. Re-exported so screens have one import for this. */
export { usePreferences };
