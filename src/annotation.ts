/**
 * AnnotationSystem – spatial voice notes for the active file.
 *
 * Flow (Airplane Seat + One Bus Stop):
 * 1. User selects a file (far plane) → context is set
 * 2. User taps Request Changes (or startListening is called)
 * 3. Web Speech API captures a short utterance
 * 4. Transcript is stored with file + PR + timestamp
 * 5. Near-plane banner shows the note; ready to post to GitHub later
 *
 * Uses the browser SpeechRecognition API (Chrome / Quest browser where available).
 * Falls back to a placeholder if speech is unavailable.
 */

import { createSystem } from '@iwsdk/core';

export interface SpatialAnnotation {
  id: string;
  prId: number;
  filePath: string;
  transcript: string;
  createdAt: number;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((ev: {
        results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }>;
      }) => void)
    | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>)
      : null;
  if (!w) return null;
  return (
    (w.SpeechRecognition as new () => SpeechRecognitionLike) ||
    (w.webkitSpeechRecognition as new () => SpeechRecognitionLike) ||
    null
  );
}

export class AnnotationSystem extends createSystem({}) {
  private annotations: SpatialAnnotation[] = [];
  private listening = false;
  private recognition: SpeechRecognitionLike | null = null;

  /** Called by DashboardSystem when Request Changes is chosen */
  public startListening(context: {
    prId: number;
    filePath: string;
    onStatus?: (msg: string) => void;
    onComplete?: (ann: SpatialAnnotation) => void;
  }): void {
    if (this.listening) {
      this.stopListening();
    }

    const SpeechRec = getSpeechRecognition();
    if (!SpeechRec) {
      const ann = this.commitAnnotation(
        context.prId,
        context.filePath,
        '(voice unavailable – add a headset mic or use Chrome)',
      );
      context.onStatus?.('Voice unavailable · placeholder note saved');
      context.onComplete?.(ann);
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    this.recognition = rec;
    this.listening = true;

    context.onStatus?.('Listening… speak your review note');

    rec.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const text = last?.[0]?.transcript?.trim() ?? '';
      if (!text) return;

      if (
        (last as { isFinal?: boolean }).isFinal !== false ||
        text.length > 0
      ) {
        context.onStatus?.(
          `Hearing: ${text.slice(0, 48)}${text.length > 48 ? '…' : ''}`,
        );
      }

      if ((last as { isFinal?: boolean }).isFinal) {
        const ann = this.commitAnnotation(
          context.prId,
          context.filePath,
          text,
        );
        context.onStatus?.(
          `Saved · “${text.slice(0, 40)}${text.length > 40 ? '…' : ''}”`,
        );
        context.onComplete?.(ann);
        this.listening = false;
      }
    };

    rec.onerror = (ev) => {
      console.warn('[Annotation] speech error', ev.error);
      context.onStatus?.(`Mic error: ${ev.error}`);
      this.listening = false;
    };

    rec.onend = () => {
      this.listening = false;
      this.recognition = null;
    };

    try {
      rec.start();
      console.log(
        `[Annotation] Listening for note on ${context.filePath} (PR #${context.prId})`,
      );
    } catch (err) {
      console.error('[Annotation] failed to start', err);
      context.onStatus?.('Could not start microphone');
      this.listening = false;
    }
  }

  public stopListening(): void {
    try {
      this.recognition?.stop();
    } catch {
      /* ignore */
    }
    this.recognition = null;
    this.listening = false;
  }

  public getAnnotations(): SpatialAnnotation[] {
    return [...this.annotations];
  }

  public getLatest(): SpatialAnnotation | null {
    return this.annotations[this.annotations.length - 1] ?? null;
  }

  private commitAnnotation(
    prId: number,
    filePath: string,
    transcript: string,
  ): SpatialAnnotation {
    const ann: SpatialAnnotation = {
      id: `ann-${Date.now()}`,
      prId,
      filePath,
      transcript,
      createdAt: Date.now(),
    };
    this.annotations.push(ann);
    console.log('[Annotation] Saved', ann);
    return ann;
  }
}