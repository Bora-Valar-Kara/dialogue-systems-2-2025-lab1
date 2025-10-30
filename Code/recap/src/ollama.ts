import type { Message } from "./types";

/*
export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
};

system - initial instructions for the LLM
user - what we say
assistant - what the AI responds
  
*/

const OLLAMA_API_URL = "http://localhost:11434/api/chat"; // after: ssh -f -N -p 62266 -L 11434:127.0.0.1:11434 guskarabo@mltgpu.flov.gu.se, this is our api endpoint

export async function fetchChatCompletion(messages: Message[]): Promise<string> { // a function that takes messages as parameter and returns promise (assistant's response, asynchronously)
  console.log("Calling Ollama with messages:", messages); // debug log
  
  try { // wrapping api call in error handling
    const response = await fetch(OLLAMA_API_URL, { // http req
      method: "POST", // sending actual data to server, not only retrieving with GET
      headers: {
        "Content-Type": "application/json", // sending json data
      },
      body: JSON.stringify({ // req the js object as json string
        model: "llama3.2:latest", // "curl http://localhost:11434/api/tags" one of them
        messages: messages, // full conversation history
        stream: false, // getting complete response, if true: token by token?
      }),
    });

	// error handling
    if (!response.ok) { // if http req is not good
      const errorText = await response.text(); // getting details (of the potential error)
      console.error("Ollama API error:", response.status, errorText); // log it
      throw new Error(`Ollama API error: ${response.status}`); // manually logging to be catched by try-catch
    }

    const data = await response.json(); // parsing json response to js object, this is our data
    console.log("Ollama response:", data);
    
    // ollama format is: data.message.content
    const assistantMessage = data.message.content;
    return assistantMessage;
    
    
    // most likely error would be ssh tunnel creation being forgettable after a potential reboot, maybe a bash script can be executed before this. But since it requires password (ssh -f -N -p 62266 -L 11434:127.0.0.1:11434 guskarabo@mltgpu.flov.gu.se), it might not be safe. better to open the tunnel beforehand.
    // or maybe json format is bad, network bad, data.message.content is undefined...
  } catch (error) {
    console.error("Error calling Ollama:", error);
    return "Error while connecting to the language model. Probably ssh tunnel is not active.";
  }
}
