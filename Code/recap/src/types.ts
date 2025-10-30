import type { SpeechStateExternalEvent } from "speechstate";
import type { AnyActorRef } from "xstate";

export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
};

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: string;
  messages: Message[];
}

export type DMEvents =
  | SpeechStateExternalEvent
  | { type: "CLICK" }
  | { type: "DONE" };
