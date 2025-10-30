import { assign, createActor, setup, fromPromise } from "xstate"; // fromPromise is to wrap async functions as xstate actors
import { speechstate } from "speechstate";
import type { Settings } from "speechstate";
import type { DMEvents, DMContext, Message } from "./types"; // Message[] was the full structure of a single conversation message, array of chat history
import { KEY } from "./azure";
import { fetchChatCompletion } from "./ollama";

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 15000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    sst_prepare: ({ context }) => 
      context.spstRef.send({ type: "PREPARE" }),
    sst_speak: ({ context, event }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: { utterance: (event as any).value || context.messages[context.messages.length - 1].content },
      }), // (event as any).value => if event has a value, use it ; || => otherwise (if there is no event value) ; context.messages[context.messages.length - 1].content => use last message
    sst_listen: ({ context }) => 
      context.spstRef.send({ type: "LISTEN" }),
  },
  actors: {
    chatCompletion: fromPromise( // to call ollama API to get LM response
      async ({ input }: { input: { messages: Message[] } }) => { // the async function that receives input, returns response ; input.messages => full conversation history
        const response = await fetchChatCompletion(input.messages); // calling our fetchChatCompletion function from ollama.ts ; await for ollama to respond (around 3 seconds)
        return response; // event.output
      }),
  },
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: "",
    messages: [ // there is one more role, user, that its content will be appended to the array after the ASR
      {
        role: "system", // we instruct the LM how to act
        content: "You are a voice assistant. You are very good at a lot of things. Keep your responses very brief please. Say 'That is all, sir.' after every generation"
      },      
      {
        role: "assistant", // LM's first message
        content: "Hello! How can I help you?"        
      }
    ],
  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        ASRTTS_READY: "Loop", // when we receive ASRTTS_READY event, we transition to "Loop" state  
      },
    },
    Loop: {
      initial: "Speaking",
      states: {
        Speaking: {
          entry: ({ context }) => { // we get the context and
            const lastMessage = context.messages[context.messages.length - 1]; // get the last message from the Messages[] array ; context.messages.length - 1 is the index of last message ; which will be the assistant line
            if (lastMessage.role === "assistant") { // the system should only speak if it is an assistant message
              context.spstRef.send({ // and we tell speechstate to speak this message
                type: "SPEAK",
                value: { utterance: lastMessage.content },
              });
            }
          },
          on: {
            SPEAK_COMPLETE: "Ask", // we transition to Ask state after the speech ends
          },
        },
        Ask: {
          entry: "sst_listen",
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => { // when the speech is RECOGNISED, we update the context (utterance - last result)
                const utterance = event.value[0]?.utterance || ""; // with the extracted text from the event.value.utterance property ; if undefined, we return empty string
                return {
                  lastResult: utterance,
                  messages: [ // then update the Messages[] array with user's message
                    ...context.messages, // to keep all existing messages, we copy all existing ones and
                    { role: "user" as const, content: utterance } // we append new user message
                  ],
                };
              }),
            },
            LISTEN_COMPLETE: "ChatCompletion", // when listening finished, we transition into the state where we call the llm
          },
        },
        ChatCompletion: {
          invoke: { // we call the actor we defined earlier
            src: "chatCompletion",
            input: ({ context }) => ({ // we pass the full conversation history as input ; context.messages
              messages: context.messages, // which, the actor will take as input.messages
            }),
            onDone: {
              target: "Speaking", // going back to Speaking state, and completing the loop
              actions: assign(({ context, event }) => ({ // before transitioning, we want the string returned by fetchChatCompletion, it is located at event.output
                messages: [ // we add assistant's response to the array with the same method as before, now the last element is the lm response, it will speak it
                  ...context.messages,
                  { role: "assistant" as const, content: event.output }
                ],
              })),
            },
            onError: { // if actor fails (ollama sometimes fails momentarily during the current loop, maybe due to network errors..)
              target: "Speaking", // we go to speaking anyways, not letting it crash
              actions: assign(({ context }) => ({ // and add an error message instead
                messages: [
                  ...context.messages,
                  { 
                    role: "assistant" as const, 
                    content: "I couldn't process that. Please say it again." 
                  }
                ],
              })),
            },
          },
        },
      },
    },
  },
});
const dmActor = createActor(dmMachine, {}).start();
dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("Messages:", state.context.messages); // we also log the conversation
  console.groupEnd();
});
export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta()
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}